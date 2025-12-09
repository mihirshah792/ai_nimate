import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

class MCPServer {
    private static instance: McpServer;

    private constructor() { }

    public static getInstance(): McpServer {
        if (!MCPServer.instance) {
            MCPServer.instance = new McpServer({
                name: "ai_animate",
                version: "1.0.0"
            });
        }

        return MCPServer.instance;
    }
}

export const server = MCPServer.getInstance();