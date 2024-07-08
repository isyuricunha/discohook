import { ActionFunctionArgs, json } from "@remix-run/cloudflare";
import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import { PermissionFlags } from "discord-bitflag";
import {
  authorizeRequest,
  getTokenGuildChannelPermissions,
} from "~/.server/session";
import {
  StorableComponent,
  discordMessageComponents,
  discordMessageComponentsToFlows,
  eq,
  flowActions,
  flows,
  generateId,
  getDb,
  inArray,
  sql,
} from "~/.server/store";
import { ZodAPIMessageActionRowComponent } from "~/types/components";
import { snowflakeAsString, zxParseJson, zxParseParams } from "~/util/zod";

export const action = async ({
  request,
  context,
  params,
}: ActionFunctionArgs) => {
  const { id } = zxParseParams(params, { id: snowflakeAsString() });
  const [token, respond] = await authorizeRequest(request, context);

  switch (request.method) {
    case "PUT": {
      const component = await zxParseJson(
        request,
        ZodAPIMessageActionRowComponent,
      );

      const db = getDb(context.env.HYPERDRIVE);
      const current = await db.query.discordMessageComponents.findFirst({
        where: (table, { eq }) => eq(table.id, id),
        columns: {
          createdById: true,
          data: true,
          channelId: true,
        },
        with: {
          componentsToFlows: {
            columns: { flowId: true },
          },
        },
      });
      if (current?.channelId) {
        const permissions = await getTokenGuildChannelPermissions(
          token,
          current.channelId,
          context.env,
        );
        if (
          !permissions.owner &&
          !permissions.permissions.has(
            PermissionFlags.ViewChannel,
            PermissionFlags.ManageMessages,
            PermissionFlags.ManageWebhooks,
          )
        ) {
          throw respond(json({ message: "Unknown Component" }, 404));
        }
      }
      if (!current) {
        throw respond(json({ message: "Unknown Component" }, 404));
      }
      if (!current.channelId && current.createdById !== BigInt(token.user.id)) {
        throw respond(json({ message: "You do not own this component" }, 403));
      }
      if (current.data.type !== component.type) {
        throw respond(json({ message: "Incorrect Type" }, 400));
      }

      const updated = await db.transaction(async (tx) => {
        await tx
          .delete(discordMessageComponentsToFlows)
          .where(
            eq(discordMessageComponentsToFlows.discordMessageComponentId, id),
          );
        const curFlowIds = current.componentsToFlows.map((ctf) => ctf.flowId);
        if (curFlowIds.length !== 0) {
          await tx.delete(flows).where(inArray(flows.id, curFlowIds));
        }

        const { custom_id: _, ...c } = component;
        let data: StorableComponent | undefined;
        let allFlowIds: string[] = [];
        switch (c.type) {
          case ComponentType.Button: {
            if (c.style === ButtonStyle.Link) {
              data = c; //{ ...current.data, ...c };
              break;
            }

            const { flow, ...rest } = c;

            const flowId = generateId();
            allFlowIds = [flowId];
            await tx
              .insert(flows)
              .values({ id: BigInt(flowId), name: flow?.name });
            if (flow && flow.actions.length !== 0) {
              await tx.insert(flowActions).values(
                flow.actions.map((action) => ({
                  flowId: BigInt(flowId),
                  type: action.type,
                  data: action,
                })),
              );
            }

            data = { ...rest, flowId };
            break;
          }
          case ComponentType.StringSelect: {
            let { flows: cFlows, ...rest } = c;
            cFlows = cFlows ?? {};
            const flowIds = Object.fromEntries(
              Object.keys(cFlows).map((optionValue) => [
                optionValue,
                generateId(),
              ]),
            );
            allFlowIds = Object.values(flowIds);

            if (Object.keys(flowIds).length !== 0) {
              await tx.insert(flows).values(
                Object.entries(cFlows).map(([optionValue, flow]) => ({
                  id: BigInt(flowIds[optionValue]),
                  name: flow.name,
                })),
              );
              const flowsWithActions = Object.entries(cFlows)
                .filter(([, flow]) => flow.actions.length !== 0)
                .map(([optionValue, flow]) => ({
                  id: BigInt(flowIds[optionValue]),
                  ...flow,
                }));
              if (flowsWithActions.length !== 0) {
                await tx.insert(flowActions).values(
                  flowsWithActions.flatMap((flow) =>
                    flow.actions.map((action) => ({
                      flowId: flow.id,
                      type: action.type,
                      data: action,
                    })),
                  ),
                );
              }
            }

            data = { ...rest, flowIds };
            break;
          }
          case ComponentType.UserSelect:
          case ComponentType.RoleSelect:
          case ComponentType.MentionableSelect:
          case ComponentType.ChannelSelect: {
            const flowId = generateId();
            allFlowIds = [flowId];
            const { flow, ...rest } = c;
            await tx
              .insert(flows)
              .values({ id: BigInt(flowId), name: flow?.name });
            if (flow && flow.actions.length !== 0) {
              await tx.insert(flowActions).values(
                flow.actions.map((action) => ({
                  flowId: BigInt(flowId),
                  type: action.type,
                  data: action,
                })),
              );
            }

            data = {
              ...rest,
              // See above
              minValues: 1,
              maxValues: 1,
              flowId,
            };
            break;
          }
          default:
            break;
        }
        if (!data) {
          tx.rollback();
          throw json(
            { message: "Failed to compile data structure for the component" },
            500,
          );
        }

        if (allFlowIds.length !== 0) {
          await tx
            .insert(discordMessageComponentsToFlows)
            .values(
              allFlowIds.map((flowId) => ({
                discordMessageComponentId: id,
                flowId: BigInt(flowId),
              })),
            )
            .onConflictDoNothing();
        }

        const updated = (
          await tx
            .update(discordMessageComponents)
            .set({
              data,
              updatedById: token.user.id,
              updatedAt: sql`NOW()`,
            })
            .where(eq(discordMessageComponents.id, id))
            .returning({
              id: discordMessageComponents.id,
              data: discordMessageComponents.data,
              draft: discordMessageComponents.draft,
            })
        )[0];
        return updated;
      });

      return respond(json(updated));
    }
    case "DELETE": {
      const db = getDb(context.env.HYPERDRIVE);
      const current = await db.query.discordMessageComponents.findFirst({
        where: (table, { eq }) => eq(table.id, id),
        columns: {
          createdById: true,
          channelId: true,
        },
      });
      if (current?.channelId) {
        const permissions = await getTokenGuildChannelPermissions(
          token,
          current.channelId,
          context.env,
        );
        if (
          !permissions.owner &&
          !permissions.permissions.has(
            PermissionFlags.ViewChannel,
            PermissionFlags.ManageMessages,
            PermissionFlags.ManageWebhooks,
          )
        ) {
          throw respond(json({ message: "Unknown Component" }, 404));
        }
      }
      if (
        !current ||
        (!current.channelId && current.createdById !== token.user.id)
      ) {
        throw respond(json({ message: "Unknown Component" }, 404));
      }

      await db
        .delete(discordMessageComponents)
        .where(eq(discordMessageComponents.id, id));

      throw respond(new Response(null, { status: 204 }));
    }
    default:
      throw respond(
        new Response(null, {
          status: 405,
          statusText: "Method Not Allowed",
        }),
      );
  }
};
