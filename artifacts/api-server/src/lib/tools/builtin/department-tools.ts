import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, departmentsTable } from "@workspace/db";
import { logActivity } from "../../activity-logger";
import { toolRegistry } from "../registry";
import type { Tool } from "../types";
import type { DepartmentCreateArgs, DepartmentRenameArgs } from "./types";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = slugify(base);
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [hit] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(eq(departmentsTable.slug, slug))
      .limit(1);
    if (!hit || hit.id === excludeId) return slug;
    slug = `${slugify(base)}-${n++}`;
  }
}

const departmentCreateTool: Tool = {
  name: "department.create",
  description: "Create a new business department (e.g. a new AI team).",
  parametersDescription: '{ "name": string (required), "description"?: string }',
  parameters: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  async execute(args) {
    const a = args as DepartmentCreateArgs;
    const slug = await uniqueSlug(a.name);
    const [created] = await db
      .insert(departmentsTable)
      .values({
        name: a.name,
        slug,
        description: a.description ?? null,
        isActive: true,
      })
      .returning();

    await logActivity({
      entityType: "department",
      entityId: created.id,
      action: "created",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "department.create", name: created.name, slug: created.slug },
    });

    return {
      ok: true,
      message: `Created department "${created.name}" (slug: ${created.slug}).`,
      data: created,
    };
  },
};

const departmentRenameTool: Tool = {
  name: "department.rename",
  description: "Rename an existing department, identified by id or current name.",
  parametersDescription:
    '{ "newName": string (required), "id"?: string, "name"?: string (current name) }',
  parameters: z.object({
    newName: z.string().min(1),
    id: z.string().optional(),
    name: z.string().optional(),
  }),
  async execute(args) {
    const a = args as DepartmentRenameArgs;
    if (!a.id && !a.name) {
      return { ok: false, message: "Provide either 'id' or 'name' to identify the department." };
    }

    const [dept] = a.id
      ? await db
          .select()
          .from(departmentsTable)
          .where(eq(departmentsTable.id, a.id))
          .limit(1)
      : await db
          .select()
          .from(departmentsTable)
          .where(eq(departmentsTable.name, a.name!))
          .limit(1);

    if (!dept) {
      return { ok: false, message: `Department not found.` };
    }

    const slug = await uniqueSlug(a.newName, dept.id);
    const [updated] = await db
      .update(departmentsTable)
      .set({ name: a.newName, slug, updatedAt: new Date() })
      .where(eq(departmentsTable.id, dept.id))
      .returning();

    await logActivity({
      entityType: "department",
      entityId: updated.id,
      action: "renamed",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "department.rename", from: dept.name, to: updated.name },
    });

    return {
      ok: true,
      message: `Renamed department "${dept.name}" to "${updated.name}".`,
      data: updated,
    };
  },
};

toolRegistry.register(departmentCreateTool);
toolRegistry.register(departmentRenameTool);
