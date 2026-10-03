import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthSessionId,
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  EnvironmentHttpApi,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpPlatform from "effect/unstable/http/HttpPlatform";
import * as Etag from "effect/unstable/http/Etag";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts";
import { ProjectEnrichmentService } from "../project/ProjectEnrichmentService.ts";
import { ProjectStoreV2 } from "./ProjectStore.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";
import { orchestrationHttpApiLayer } from "./http.ts";

class WaitApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.orchestration) {}

it.effect("requires operate scope and restricts HTTP commands to the waiter contract", () =>
  Effect.gen(function* () {
    const received: unknown[] = [];
    const routes = (operate: boolean) =>
      HttpApiBuilder.layer(WaitApi).pipe(
        Layer.provide(orchestrationHttpApiLayer),
        Layer.provide(
          Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
            effect.pipe(
              Effect.provideService(EnvironmentAuthenticatedPrincipal, {
                sessionId: AuthSessionId.make("wait-test"),
                subject: "test",
                method: "browser-session-cookie",
                scopes: new Set(
                  operate ? [AuthOrchestrationOperateScope] : [AuthOrchestrationReadScope],
                ),
              }),
            ),
          ),
        ),
        Layer.provide(
          Layer.mock(ThreadManagementService)({
            dispatch: (command) =>
              Effect.sync(() => {
                received.push(command);
                return { sequence: 1, storedEvents: [] };
              }),
          }),
        ),
        Layer.provide(Layer.mock(OrchestrationEventStore)({})),
        Layer.provide(Layer.mock(ProjectEnrichmentService)({})),
        Layer.provide(Layer.mock(ProjectStoreV2)({})),
        Layer.provide(SqlitePersistenceMemory),
        Layer.provide(
          HttpPlatform.layer.pipe(Layer.provide(NodeServices.layer), Layer.provide(Etag.layerWeak)),
        ),
        Layer.provide(Etag.layerWeak),
        Layer.provide(NodeServices.layer),
      );
    yield* Effect.acquireUseRelease(
      Effect.sync(
        () =>
          [HttpRouter.toWebHandler(routes(false)), HttpRouter.toWebHandler(routes(true))] as const,
      ),
      ([reader, operator]) =>
        Effect.tryPromise(async () => {
          const command = {
            type: "external-wait.register",
            commandId: "register",
            threadId: "thread",
            waiterId: "waiter",
            title: "External work",
          };
          const request = (body: unknown, protocol = "2") =>
            new Request("http://localhost/api/orchestration/waiters", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-t3-orchestration-protocol": protocol,
              },
              body: JSON.stringify(body),
            });
          expect((await reader.handler(request(command), Context.empty())).status).toBe(403);
          expect((await operator.handler(request(command, "1"), Context.empty())).status).toBe(400);
          expect(
            (
              await operator.handler(
                request({ ...command, type: "thread.settle" }),
                Context.empty(),
              )
            ).status,
          ).toBe(400);
          const response = await operator.handler(request(command), Context.empty());
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ sequence: 1 });
          expect(received).toEqual([command]);
        }),
      ([reader, operator]) =>
        Effect.promise(async () => {
          await reader.dispose();
          await operator.dispose();
        }),
    );
  }),
);
