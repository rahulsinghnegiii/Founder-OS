import type { Tool, ToolResult, ToolContext } from "./types";

class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** Register (or replace) a tool at runtime. Safe to call multiple times. */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /**
   * Execute a tool by name. Handles missing tools, argument validation,
   * and runtime errors gracefully — never throws to the caller.
   */
  async execute(name: string, args: unknown, ctx: ToolContext = {}): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, message: `Unknown tool: ${name}` };
    }

    const parsed = tool.parameters.safeParse(args);
    if (!parsed.success) {
      return {
        ok: false,
        message: `Invalid arguments for ${name}: ${parsed.error.message}`,
      };
    }

    try {
      return await tool.execute(parsed.data, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Tool ${name} failed: ${message}` };
    }
  }

  /** Build a discovery prompt fragment listing every registered tool. */
  discoveryPrompt(): string {
    if (this.tools.size === 0) return "(no tools available)";
    return this.list()
      .map((t) => `- ${t.name}: ${t.description}\n  params: ${t.parametersDescription}`)
      .join("\n");
  }
}

export const toolRegistry = new ToolRegistry();
