import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("The waiter does not run a provider"),
} as ProviderAdapterV2Shape;
const database = SqlitePersistenceMemory;
const testLayer = Layer.mergeAll(
  database,
  ProjectionStore.layer.pipe(Layer.provide(database)),
  makeOrchestratorV2ReplayLayerWithRegistry(
    { name: "external-wait" },
    ProviderAdapterRegistry.makeLayer([adapter]),
    { databaseLayer: database, runEffectWorker: false },
  ),
);

it.effect(
  "persists waiting, completes once, preserves other waiters and suppresses cancelled wakes",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("thread:external-wait");
      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make("create"),
        threadId,
        projectId: ProjectId.make("project:external-wait"),
        title: "Wait",
        modelSelection: { instanceId, model: "test-model" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      const register = {
        type: "external-wait.register" as const,
        commandId: CommandId.make("register-a"),
        threadId,
        waiterId: "a",
        title: "CI",
      };
      yield* orchestrator.dispatch(register);
      yield* orchestrator.dispatch(register);
      yield* orchestrator.dispatch({
        ...register,
        commandId: CommandId.make("register-b"),
        waiterId: "b",
      });
      assert.equal((yield* projections.getThreadShell(threadId))?.status, "waiting");
      const waiting = yield* projections.getThreadProjection(threadId);
      assert.equal(waiting.thread.externalWaiters?.length, 2);
      assert.equal(ProjectionStore.threadShellFromProjection(waiting).status, "waiting");
      assert.equal(
        (yield* projections.getShellSnapshot()).threads.find((thread) => thread.id === threadId)
          ?.status,
        "waiting",
      );

      const complete = {
        type: "external-wait.complete" as const,
        commandId: CommandId.make("complete-a"),
        threadId,
        waiterId: "a",
        messageId: MessageId.make("result-a"),
        text: "CI passed. Continue.",
      };
      yield* orchestrator.dispatch(complete);
      yield* orchestrator.dispatch(complete);
      const resumed = yield* projections.getThreadProjection(threadId);
      assert.equal(resumed.runs.length, 1);
      assert.equal(
        resumed.messages.filter((message) => message.id === complete.messageId).length,
        1,
      );
      assert.deepEqual(
        resumed.thread.externalWaiters?.map((waiter) => waiter.id),
        ["b"],
      );
      assert.notEqual((yield* projections.getThreadShell(threadId))?.status, "waiting");
      const run = resumed.runs[0]!;
      const now = yield* DateTime.now;
      yield* projections.apply({
        id: EventId.make("completed"),
        type: "run.updated",
        threadId,
        runId: run.id,
        occurredAt: now,
        payload: { ...run, status: "completed", completedAt: now },
      });
      assert.equal((yield* projections.getThreadShell(threadId))?.status, "waiting");
      yield* orchestrator.dispatch({
        type: "external-wait.cancel",
        commandId: CommandId.make("cancel-b"),
        threadId,
        waiterId: "b",
      });
      assert.equal((yield* projections.getThreadShell(threadId))?.status, "completed");
      yield* orchestrator.dispatch({
        ...complete,
        commandId: CommandId.make("late-b"),
        waiterId: "b",
        messageId: MessageId.make("result-b"),
      });
      assert.equal((yield* projections.getThreadProjection(threadId)).runs.length, 1);
    }).pipe(Effect.provide(testLayer)),
);
