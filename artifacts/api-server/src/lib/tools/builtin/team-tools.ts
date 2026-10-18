import { z } from "zod/v4";
import { db, teamMembersTable } from "@workspace/db";
import { logActivity } from "../../activity-logger";
import { toolRegistry } from "../registry";
import type { Tool } from "../types";
import type { TeamMemberCreateArgs } from "./types";

const teamMemberCreateTool: Tool = {
  name: "team-member.create",
  description: "Add a team member or invite someone to the team. Use when the founder wants to hire, onboard, or add a person to the team.",
  parametersDescription:
    '{ "name": string (required), "role"?: string, "email"?: string, "department"?: string }',
  parameters: z.object({
    name: z.string().min(1),
    role: z.string().optional(),
    email: z.string().optional(),
    department: z.string().optional(),
  }),
  async execute(args) {
    const a = args as TeamMemberCreateArgs;
    const [created] = await db
      .insert(teamMembersTable)
      .values({
        name: a.name,
        role: a.role ?? null,
        email: a.email ?? null,
        department: a.department ?? null,
        status: "invited",
      })
      .returning();

    await logActivity({
      entityType: "team_member",
      entityId: created.id,
      action: "invited",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "team-member.create", name: created.name, department: created.department },
    });

    const role = created.role ? ` as ${created.role}` : "";
    const dept = created.department ? ` in ${created.department}` : "";
    return {
      ok: true,
      message: `Added ${created.name}${role}${dept} to the team (invited).`,
      data: created,
    };
  },
};

toolRegistry.register(teamMemberCreateTool);
