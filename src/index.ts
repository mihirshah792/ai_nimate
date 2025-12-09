import { server } from "./utils/mcp_server";
import express from 'express';
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import z from 'zod';
import { prompt } from './utils/prompt';
import { ManimScriptCompiler } from "./services/manim.script.compiler";

// Register your prompt
server.registerPrompt(
  'generate-and-render',
  {
    title: 'Generate and Render Video Script',
    description: 'Creates an AI-generated video script based on your topic, then renders it using video generation tools',
    argsSchema: { userPrompt: z.string() }
  },
  ({ userPrompt }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: prompt.replace("{{SCENE_DESCRIPTION}}", userPrompt)
        }
      }
    ]
  })
);

// Register your tool
server.registerTool(
  'render-video',
  {
    title: 'Compile Video',
    description: 'Renders a video from a structured script. Takes the script content, duration, and optional settings to generate the final video file.',
    inputSchema: { script: z.string() }
    // outputSchema: { url: z.string() }
  },
  async ({ script }) => {
    const compiler = new ManimScriptCompiler();
    const response = await compiler.compileScript(script);
    const videoUrl = response.status === 'success' ? response.payload : '';
    console.error("videoUrl: "+videoUrl);
    return {
      content: [{
        type: 'text',
        text: videoUrl === '' ? `Could not render your video.` : `Video rendered successfully! URL: ${videoUrl}`
      }]
    };
  }
);

async function startServer() {
  const isStdioMode = process.argv.includes('--stdio');

  if (isStdioMode) {
    // Stdio mode for Claude Desktop
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP Server running in stdio mode for Claude Desktop');
  } else {
    // HTTP mode for testing/debugging
    const app = express();
    app.use(express.json());

    app.post('/mcp', async (req, res) => {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true
        });

        res.on('close', () => {
          transport.close();
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error'
            },
            id: null
          });
        }
      }
    });

    const port = parseInt(process.env.PORT || '3000');
    app.listen(port, () => {
      console.log(`MCP Server running on http://localhost:${port}/mcp`);
    }).on('error', error => {
      console.error('Server error:', error);
      process.exit(1);
    });
  }
}

// Start the server
startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});