# Letta Code — Code Snippets

Reader 2 notes. Source is the `origin/` symlink to `/Users/mahiro/ghq/github.com/letta-ai/letta-code`.

Verified git HEAD: `d7fd0a6cb6713c7fe0f3db84167e6b7ae05df01f` (`d7fd0a6cb`, 2026-09-24 23:07 -0700, `refactor(memory): initialize with workflow analysis (#4643)`). Package `@letta-ai/letta-code` version `0.33.1` (`package.json`). Bin entry is `letta` → `letta.js`; the TypeScript startup that was read is `src/index.ts`.

Facts below are from files opened in this pass. Anything not opened is marked as a hypothesis.

## CLI startup

`main()` is the process entry. It marks a timing milestone, loads desktop credentials, then peels off `--backend` before any TUI work. A recognized subcommand exits the process and never reaches the agent loop.

```570:629:src/index.ts
async function main(): Promise<void> {
  markMilestone("CLI_START");
  await initializeDesktopCredentials();

  // Exit when the owning Desktop or terminal process dies.
  startOrphanDetection();

  const rawCliArgs = process.argv.slice(2);
  let subcommandArgs = rawCliArgs;
  let explicitBackendMode: BackendMode | undefined;
  try {
    const backendSelection = extractBackendFlag(rawCliArgs);
    subcommandArgs = normalizeUpdateCommandAliases(backendSelection.args);
    if (backendSelection.backend) {
      explicitBackendMode = backendSelection.backend;
      configureBackendMode(backendSelection.backend);
    }
  } catch (error) {
    trackCliBoundaryError(
      "cli_backend_flag_parse_failed",
      error,
      "startup_backend_flag_parse",
    );
    console.error(
      error instanceof Error ? `Error: ${error.message}` : String(error),
    );
    process.exit(1);
  }
  // ...
  const subcommandResult = await runSubcommand(subcommandArgs);
  if (subcommandResult !== null) {
    process.exit(subcommandResult);
  }
```

Why it matters: startup errors are classified (`trackCliBoundaryError`) and then exit `1`. Subcommands are a hard fork away from the interactive/headless agent path.

The subcommand table returns `null` when argv is empty, which is the signal to continue into agent mode. `memory` and the legacy alias `memfs` share one handler.

```76:91:src/cli/subcommands/router.ts
export async function runSubcommand(argv: string[]): Promise<number | null> {
  const [command, ...rest] = argv;

  if (!command) {
    return null;
  }

  switch (command) {
    case "version":
      return runVersionSubcommand();
    case "update":
    case "upgrade":
      return runUpdateSubcommand();
    case "memory":
    case "memfs": // legacy alias
      return runMemorySubcommand(rest);
```

After flags and permission mode are applied, headless (`-p`) loads tools in-process and calls `handleHeadlessCommand`. The TUI path lazy-imports React and Ink so a one-shot prompt does not pay for the UI.

```1293:1330:src/index.ts
  if (isHeadless) {
    markMilestone("HEADLESS_MODE_START");
    // For headless mode, load tools synchronously (respecting model/toolset when provided)
    await loadStartupTools({
      modelIdentifier: specifiedModel,
      toolset: specifiedToolset as ToolsetPreference | undefined,
      exclude: ["AskUserQuestion"],
    });
    markMilestone("TOOLS_LOADED");
    // ...
    const { handleHeadlessCommand } = await import("@/headless");
    await handleHeadlessCommand(
      { values: headlessValues, positionals },
      specifiedModel,
      skillsDirectory,
      resolvedSkillSources,
      !noSystemInfoReminderFlag,
      { requestedBackendMode: explicitBackendMode },
    );
    return;
  }

  markMilestone("TUI_MODE_START");

  // Interactive: lazy-load React/Ink + App
  markMilestone("REACT_IMPORT_START");
  const [React, { render }, AppModule] = await Promise.all([
    import("react"),
    import("ink"),
    import("@/cli/App"),
  ]);
```

The interactive process ends by rendering an Ink `LoadingApp`. Ctrl-C is not Ink’s default exit; the app handles it. `assertSupportedBunRuntime()` runs before `main()`.

```2578:2597:src/index.ts
  markMilestone("REACT_RENDER_START");
  render(
    React.createElement(LoadingApp, {
      forceNew: forceNew,
      baseTools: baseTools,
      agentIdArg: specifiedAgentId,
      preResolvedAgent: nameResolvedAgent,
      model: specifiedModel,
      systemPromptPreset: systemPromptPreset,
      toolset: specifiedToolset as ToolsetPreference | undefined,
      skillsDirectory: skillsDirectory,
    }),
    {
      exitOnCtrlC: false, // We handle CTRL-C manually with double-press guard
    },
  );
}

assertSupportedBunRuntime();
main();
```

## Agent loop

The interactive loop is not a free function. It is `useConversationLoop` in `src/cli/app/use-conversation-loop.ts`. `processConversation` is the turn function. It pins the permission mode for the whole submission so a retry cannot drop YOLO/unrestricted, copies the input so recovery can mutate it, and refuses a second concurrent call unless `allowReentry` is set (tool-result continuations use that flag).

```478:565:src/cli/app/use-conversation-loop.ts
  // Core streaming function - iterative loop that processes conversation turns
  const processConversation = useCallback(
    async (
      initialInput: Array<MessageCreate | ApprovalCreate>,
      options?: {
        allowReentry?: boolean;
        submissionGeneration?: number;
        transcriptStartLineIndex?: number | null;
        allowResponseStateReuse?: boolean;
      },
    ): Promise<void> => {
      const pinnedPermissionMode = uiPermissionModeRef.current;
      // ...
      const inputList = Array.isArray(initialInput) ? initialInput : [];
      let currentInput = [...inputList];
      const allowReentry = options?.allowReentry ?? false;
      const myGeneration =
        options?.submissionGeneration ?? conversationGenerationRef.current;

      if (myGeneration !== conversationGenerationRef.current) {
        return;
      }

      if (processingConversationRef.current > 0 && !allowReentry) {
        return;
      }
      processingConversationRef.current += 1;
```

Before the HTTP call, mods can rewrite or cancel the turn via `turn_start`. A thrown mod handler is swallowed so it cannot block the user message. That is verified in the `catch` at lines 586–590 of the same function: the original input is restored and the cancel reason is cleared.

The turn itself is `while (true)`. Each iteration injects queued skill text, then calls `sendMessageStream` with a prepared tool context. Pre-stream failures stay inside the loop instead of killing the turn.

```746:808:src/cli/app/use-conversation-loop.ts
        while (true) {
          const signal = abortControllerRef.current?.signal;

          if (signal?.aborted) {
            const isStaleAtAbort =
              myGeneration !== conversationGenerationRef.current;
            if (!isStaleAtAbort) {
              setStreaming(false);
            }
            return;
          }

          const { consumeQueuedSkillContent } = await import(
            "@/tools/impl/skill-content-registry"
          );
          const skillContents = consumeQueuedSkillContent();
          // ...
          let stream: Awaited<ReturnType<typeof sendMessageStream>> | null =
            null;
          try {
            const preparedToolContext = await prepareScopedToolExecutionContext(
              tempModelOverrideRef.current ?? undefined,
            );
            prefetchedAgent = preparedToolContext.agent;
            const nextStream = await sendMessageStream(
              conversationIdRef.current,
              currentInput,
              {
                agentId: agentIdRef.current,
                overrideModel: tempModelOverrideRef.current ?? undefined,
                preparedToolContext: preparedToolContext.preparedToolContext,
                allowResponseStateReuse:
                  options?.allowResponseStateReuse === true,
              },
            );
            stream = nextStream;
            turnToolContextId = getStreamToolContextId(nextStream);
```

`sendMessageStream` always talks to the conversations API. SDK retries are off (`maxRetries: 0`) because state lives outside the stream. The request body is streaming, background, and includes the current client tools and skills. The `"default"` conversation is special: it requires `agentId` in the body.

```308:362:src/agent/message.ts
  return {
    messages,
    streaming: true,
    stream_tokens: opts.streamTokens ?? true,
    include_pings: true,
    background: opts.background ?? true,
    client_skills: clientSkills,
    client_tools: clientTools,
    include_compaction_messages: true,
    ...(opts.overrideModel ? { override_model: opts.overrideModel } : {}),
    ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
    ...(isDefaultConversation ? { agent_id: opts.agentId } : {}),
  };
}

export async function sendMessageStream(
  conversationId: string,
  messages: Array<MessageCreate | ApprovalCreate>,
  opts: SendMessageStreamOptions = { streamTokens: true, background: true },
  requestOptions: SendMessageStreamRequestOptions = {
    maxRetries: 0,
  },
): Promise<Stream<LettaStreamingResponse>> {
  return sendMessageStreamWithBackend(
    getBackend(),
    conversationId,
    messages,
    opts,
    requestOptions,
  );
}
```

`drainStream` consumes that SSE stream into transcript buffers and a `StreamProcessor`. A terminal-EOF guard aborts the HTTP read once the terminal sequence has arrived, so the UI does not wait forever for body close.

```113:146:src/cli/helpers/stream.ts
export async function drainStream(
  stream: Stream<LettaStreamingResponse>,
  buffers: ReturnType<typeof createBuffers>,
  refresh: () => void,
  abortSignal?: AbortSignal,
  onFirstMessage?: () => void,
  onChunkProcessed?: DrainStreamHook,
  contextTracker?: ContextTracker,
  seenSequenceCursor?: StreamSequenceCursor | null,
  isResumeStream?: boolean,
  skipCancelToolsOnError?: boolean,
  actingUserId?: string,
): Promise<DrainResult> {
  const startTime = performance.now();
  const requestStartTime = getStreamRequestStartTime(stream) ?? startTime;
  // ...
  const streamProcessor = new StreamProcessor(seenSequenceCursor ?? null);
  const terminalEofGuard = createTerminalEofGuard({
    getStopReason: () => streamProcessor.stopReason,
    getRunId: () => streamProcessor.lastRunId,
    abortHttpRead: () => abortStreamController(stream, "terminal_eof_guard"),
  });
```

When the stream stops on approvals, auto-allowed tools run locally. Their results are not returned to the caller as a final answer. The hook re-enters `processConversation` with an approval message. `allowResponseStateReuse: true` lets a fully auto-handled continuation reuse cached response state (the gate for that lives in `sendMessageStream`, lines 458–467 of `src/agent/message.ts`).

```2099:2116:src/cli/app/use-conversation-loop.ts
                setThinkingMessage(getRandomThinkingVerb());
                refreshDerived();

                toolResultsInFlightRef.current = true;
                await processConversation(
                  [
                    {
                      type: "approval",
                      approvals: allResults,
                      otid: randomUUID(),
                    },
                  ],
                  {
                    allowReentry: true,
                    allowResponseStateReuse: true,
                  },
                );
```

Verified shape of one turn: user input → `sendMessageStream` → `drainStream` → local tool execution on approval → re-entry with `type: "approval"`. The model loop itself is on the Letta backend; this client is the harness around that stream.

Hypothesis: `src/headless.ts` (`handleHeadlessCommand`, opened only at its signature around line 658) repeats this recovery policy. The TUI catch comment at line 824 says “parity with headless.ts”. The headless `while` body was not read in this pass.

## Tools

A tool is schema + markdown description + implementation, packed by `defineTool`. The runner is typed, then erased to `ToolArgs`.

```21:38:src/tools/define-tool.ts
export function defineTool<TArgs extends object, TResult>(input: {
  schema: JsonSchema;
  description: string;
  modelForm?: ModelFacingToolForm;
  impl: TypedToolImplementation<TArgs, TResult>;
}): ToolAssets {
  return {
    schema: input.schema,
    description: input.description,
    modelForm:
      input.modelForm ??
      functionToolForm({
        description: input.description,
        parameters: input.schema,
      }),
    impl: (args) => input.impl(args as TArgs),
  };
}
```

`executeToolInner` resolves a context-scoped registry. Missing context is an error result, not a throw. Before a local or mod tool runs, it waits for memory checkouts. External tools skip that wait unless they are also mod tools.

```2099:2161:src/tools/manager.ts
async function executeToolInner(
  name: string,
  args: ToolArgs,
  options?: { /* signal, toolCallId, onOutput, toolContextId, parentScope */ },
): Promise<ToolExecutionResult> {
  const context = options?.toolContextId
    ? getExecutionContextById(options.toolContextId)
    : undefined;
  if (options?.toolContextId && !context) {
    return {
      toolReturn: `Tool execution context not found: ${options.toolContextId}`,
      status: "error",
    };
  }
  const activeRegistry = context?.toolRegistry ?? toolRegistry;
  // ...
  try {
    if (!activeExternalTools.has(name) || activeModTools.has(name))
      await waitForToolCheckouts(/* ... */);
  } catch (error) {
    return {
      status: "error",
      toolReturn: `Memory checkout is unavailable: ${String(error)}`,
    };
  }
```

Dispatch order, verified by reading the same function: mod tool, then external/SDK tool, then internal name lookup. Each path emits `tool_start` first; a handler that returns a result short-circuits execution. Unknown names return `status: "error"` with the available-tool list (lines 2253–2264).

The internal call injects abort `signal`, shell secret env, and parent scope, then `await tool.fn(...)`. File-mutating tools best-effort broadcast the new file contents. A tool that returns `status: "error"` is a successful function return, not an exception.

```2371:2418:src/tools/manager.ts
      if (internalName === "Task") {
        if (options?.toolCallId) {
          enhancedArgs = { ...enhancedArgs, toolCallId: options.toolCallId };
        }
        // ...
      }
      const result = await tool
        .fn(enhancedArgs)
        .finally(() => outputStreamer?.flush());
      // ...
      if (options?.onFileWrite && FILE_MUTATING_TOOLS.has(internalName)) {
        // best-effort read + onFileWrite; catch does not fail the tool
      }
```

`executeTool` wraps that and then emits `tool_end`. The first mod handler that returns `{ result }` replaces what the model sees, and only for string returns. The replacement is secret-scrubbed (lines 2609–2627).

Approvals do not run tools one-by-one in call order. `executeApprovalBatch` pre-allocates a result array, runs parallel-safe tools together, and serializes write tools that share a resource key. Different files can still run at the same time. `GLOBAL_LOCK_TOOLS` (lines 72–80) includes `Bash`, `memory`, and `ApplyPatch`.

```407:421:src/agent/approval-execution.ts
  await Promise.all([
    ...parallelIndices.map(execute),
    ...denyIndices.map(execute),
    ...Array.from(writeToolsByResource.values()).map(async (indices) => {
      for (const i of indices) {
        await execute(i);
      }
    }),
  ]);
```

The registry swap is intentionally synchronous. Comment at `replaceRegistry` (lines 1204–1216 of `src/tools/manager.ts`): clear and refill in one block with no `await`, so a toolset switch cannot observe an empty registry.

## Memory

Memory is a git checkout, not a blob store. Cloud agents live under `~/.letta/agents/<id>/memory`. Local backend mode uses a different storage root.

```29:83:src/agent/memory-filesystem.ts
export const MEMORY_FS_ROOT = ".letta";
export const MEMORY_FS_AGENTS_DIR = "agents";
export const MEMORY_FS_MEMORY_DIR = "memory";
export const MEMORY_SYSTEM_DIR = "system";

export function getMemoryFilesystemRoot(agentId: string, homeDir = homedir()): string {
  return join(homeDir, MEMORY_FS_ROOT, MEMORY_FS_AGENTS_DIR, agentId, MEMORY_FS_MEMORY_DIR);
}

export function getScopedMemoryFilesystemRoot(agentId: string, options = {}): string {
  const env = options.env ?? process.env;
  if (isLocalBackendEnvEnabled(env)) {
    // LETTA_LOCAL_BACKEND_DIR or the default local storage dir
    return getLocalBackendMemoryFilesystemRoot(agentId, storageDir);
  }
  return getMemoryFilesystemRoot(agentId, options.homeDir ?? homedir());
}
```

`ensureLocalMemfsCheckout` (lines 271–297) does not change prompts or tags. Local backend calls `initializeLocalMemoryRepo`. An existing git dir either pulls or installs hooks. Otherwise it clones.

The `memory` tool refuses a no-op. It checks the repo is clean, applies the command, and commits. Local mode stays local; hosted mode returns a sha and says the harness will sync after the turn.

```102:159:src/tools/impl/memory.ts
export async function memory(args: MemoryArgs): Promise<MemoryResult> {
  validateRequiredParams(args, ["command", "reason"], "memory");
  // reason must be non-empty; repo must be clean
  const affectedPaths = await applyMemoryCommand(memoryDir, args, memoryFormat);
  if (affectedPaths.length === 0) {
    throw new Error(
      `Memory ${args.command} made no changes: it produced no changed paths. ` +
        "Verify the command targets the intended file(s) and actually modifies content.",
    );
  }
  const commitResult = await commitMemoryWrite({
    memoryDir,
    pathspecs: affectedPaths,
    reason,
    author: { agentId, authorName, authorEmail: `${agentId}@letta.com` },
    syncMode,
  });
  emitMemoryUpdated(affectedPaths);
  return {
    message:
      syncMode === "local"
        ? `Memory ${args.command} committed locally (${commitResult.sha?.slice(0, 7) ?? "unknown"}).`
        : `Memory ${args.command} committed (${commitResult.sha?.slice(0, 7) ?? "unknown"}); harness will sync after the turn.`,
  };
}
```

`commitMemoryWrite` (lines 1319–1357 of `src/agent/memory-git.ts`) branches on `syncMode === "local"` versus a token-authenticated remote prepare, then `commitMemoryPaths`.

Git is spawned with `execFile("git", ...)`, never a shell string. Auth args and credential-helper values are redacted before logs. Failures are rethrown through `redactGitAuthError`.

```557:603:src/agent/memory-git.ts
export async function runGit(cwd, args, token?, options?): Promise<{ stdout: string; stderr: string }> {
  const authArgs = token ? buildGitAuthArgs(token) : [];
  const allArgs = [
    ...GIT_DISABLE_COMMIT_SIGNING_ARGS,
    ...buildMemfsGitProxyArgs(args),
    ...authArgs,
    ...args,
  ];
  // credential helper values and push URLs are redacted in debug logs
  try {
    result = await execFile("git", allArgs, {
      cwd,
      env: buildNonInteractiveGitEnv(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: timeoutMs,
    });
  } catch (error) {
    throw redactGitAuthError(error);
  }
  return { stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" };
}
```

## Subagents

Built-ins are markdown files imported at build time (`src/agent/subagents/index.ts` lines 22–54): fork, general-purpose, init, memory, recall, reflection, plus v2 variants for memfs. Custom agents are markdown plus YAML frontmatter under `.letta/agents/` (file header comment, lines 1–7). The parser was not read.

`spawnSubagent` freezes the launch working directory in a runtime context so a parent worktree change during model lookup does not move the child.

```986:994:src/agent/subagents/manager.ts
export function spawnSubagent(...args: Parameters<typeof spawnSubagentInContext>): Promise<SubagentResult> {
  return runWithRuntimeContext(
    { ...getRuntimeContext(), workingDirectory: getCurrentWorkingDirectory() },
    () => spawnSubagentInContext(...args),
  );
}
```

`spawnSubagentInContext` (lines 817–983) loads config by type, picks local vs api from `activeBackend.capabilities.localMemfs`, inherits the parent model, and may prepend a deploy or fork system reminder. Unknown types return `{ success: false, error }` rather than throwing (lines 840–847).

`executeSubagent` builds CLI args, resolves a launcher that re-invokes this same `letta` binary (`resolveSubagentLauncher`, lines 85–120 of `src/agent/subagents/subagent-launcher.ts`), composes child env (API key, memory roots, launch profile), optionally wraps a memory subagent in an OS sandbox, then spawns. The prompt goes to the child’s stdin. Status becomes `"running"` on the `spawn` event, not when the child later reports an agent id.

```448:481:src/agent/subagents/manager.ts
    const runningProcess = spawnSubagentProcess(managedCommand, managedArgs, {
      cwd: subagentWorkingDirectory,
      env: spawnEnv,
      signal,
    });
    const proc = runningProcess.process;
    proc.stdin.on("error", () => {});
    proc.stdin.end(boundedUserPrompt);

    proc.once("spawn", () => {
      updateSubagent(subagentId, { status: "running" });
    });
    // stdout is split on newlines by hand; readline is avoided
    // because nested Bun child-process line readers were unstable
```

A second subagent path exists: `executeWorkflow` in `src/tools/workflow/workflow-engine.ts`. A script calls `agent(prompt)`. Every call is tracked in `inFlight` even if the script forgets to await it, and a stray rejection is swallowed on the fire-and-forget branch so it is not an unhandled rejection. The awaited branch still sees the original error.

```86:94:src/tools/workflow/workflow-engine.ts
  function agent(prompt: unknown, callOptions?: unknown): Promise<unknown> {
    const pending = callAgent(prompt, callOptions);
    void pending.catch(() => {});
    inFlight.add(pending);
    void pending.finally(() => inFlight.delete(pending)).catch(() => {});
    return pending;
  }
```

Hypothesis: the Workflow tool’s spawner is the SDK loader in `src/tools/workflow/sdk-spawner.ts`, not `spawnSubagent`. That file was not read past the export list.

## Error handling

Pre-stream API errors are classified into four actions. Stale approvals are recovered. Conversation-busy and transient HTTP errors retry inside a budget. Everything else is rethrown.

```391:419:src/agent/turn-recovery-policy.ts
export function getPreStreamErrorAction(detail, conversationBusyRetries, maxConversationBusyRetries, opts?): PreStreamErrorAction {
  const kind = classifyPreStreamConflict(detail);
  if (kind === "approval_pending") return "resolve_approval_pending";
  if (kind === "conversation_busy" && conversationBusyRetries < maxConversationBusyRetries) {
    return "retry_conversation_busy";
  }
  if (opts && shouldRetryPreStreamTransientError({ status: opts.status, detail })
      && (opts.transientRetries ?? 0) < (opts.maxTransientRetries ?? 0)) {
    return "retry_transient";
  }
  return "rethrow";
}
```

`extractConflictDetail` (lines 433–454) walks nested SDK shapes: `error.error.detail`, then `error.error.message`, then string bodies, then `Error.message`.

The TUI applies that classifier in the `sendMessageStream` catch (lines 809–874). Approval recovery increments `llmApiErrorRetriesRef`, fetches the real pending approvals, and rebuilds the input as fresh denials. The denial reason is explicit that the harness closed a desynced tool call, not the user (`STALE_APPROVAL_RECOVERY_DENIAL_REASON`, lines 464–465). If the fetch fails, it strips the stale payload and retries. `continue` restarts the `while (true)` loop.

Later in the same loop, quota errors on the hosted API set a temporary Auto model override and append `"Keep going."` (lines 2391–2441). Local backends skip that fallback because `capabilities.localModelCatalog` is set. Empty responses retry, and the last attempt appends a `<system-reminder>` (lines 2444–2469).

Thrown tool errors are caught inside `executeToolInner`. Abort is normalized to a user-interrupt message. The message is secret-scrubbed before telemetry or the model sees it. The function returns `{ status: "error" }` and does not `console.error` (the comment says that would pollute the TUI).

```2496:2554:src/tools/manager.ts
    } catch (error) {
      const isAbort =
        error instanceof Error &&
        (error.name === "AbortError" ||
          error.message === "The operation was aborted" ||
          ("code" in error && error.code === "ABORT_ERR"));
      const errorMessage = isAbort
        ? INTERRUPTED_BY_USER
        : scrubSecretsFromString(
            error instanceof Error ? error.message : String(error),
            invocationRedactions,
          );
      telemetry.trackToolUsage(internalName, false, duration, errorMessage.length, errorType, errorMessage);
      // post-tool hooks still run
      return { toolReturn: finalErrorMessage, status: "error" };
    }
```

Bash treats abort as a failed outcome with the same interrupt string, and keeps a head-and-tail excerpt of large failure logs (comment at lines 572–575 of `src/tools/impl/bash.ts`).

```589:605:src/tools/impl/bash.ts
      if (failed) {
        const isAbort =
          signal?.aborted ||
          ("error" in result &&
            (result.error.name === "AbortError" ||
              (result.error as NodeJS.ErrnoException).code === "ABORT_ERR"));
        return {
          content: [{
            type: "text",
            text: isAbort
              ? INTERRUPTED_BY_USER
              : `${recoveryNote}${result.detail}\n${truncatedOutput}`,
          }],
          status: "error",
        };
      }
```

Git retries are separate from LLM retries. `runGitWithRetry` (lines 640–686 of `src/agent/memory-git.ts`) recreates a missing cwd, retries only `isRetryableGitTransientError` (HTTP 503 / Cloudflare 52x style messages), and uses exponential backoff `baseDelayMs * 2 ** (attempt - 1)`. Non-retryable errors throw immediately.

Tool contract, from `src/tools/README.md`: return `{ toolReturn, status: "success" | "error" }`. Pass `AbortSignal` into subprocesses. Do not `console.error` from tools.

## Patterns worth keeping

- Client harness, server model loop. This process streams, approves, and executes tools, then sends approval messages back.
- Generation counters (`conversationGenerationRef`) let Escape invalidate a turn that has not started rendering yet.
- Errors the model should see are return values (`status: "error"`). Process-fatal errors are startup `process.exit(1)` plus telemetry.
- Secrets are scrubbed at tool return, thrown-error, and git-log boundaries.
- Subagents are child CLI processes with stdin prompts, not in-process function calls. Memory-profile children can be OS-sandboxed.
- Memory writes are git commits with an agent email `<agentId>@letta.com`. Hosted sync is deferred until after the turn.

## Open questions

- The headless turn loop in `src/headless.ts` was not read past `handleHeadlessCommand`’s signature. Does it call the same `processConversation`, or a parallel implementation that only shares `getPreStreamErrorAction`?
- Where does the websocket listener (`src/websocket/listener/turn.ts`) sit relative to this CLI loop? Tests call `executeTool` from that tree. It may be a third harness (App Server) rather than the TUI path.
- `syncPendingMemoryCommitsAfterTurn` in `src/agent/memory-git.ts` was not read. The memory tool’s “harness will sync after the turn” string points there, but the caller was not confirmed.
- Custom subagent frontmatter parsing (`parseFrontmatter` in `src/agent/subagents/index.ts`) was not read, so the user-defined schema is unverified.
- Workflow `agent()` vs `spawnSubagent`: which launcher the Workflow tool actually uses was not confirmed in `sdk-spawner.ts`.
