import {McpServer} from "@modelcontextprotocol/server";
import {serveStdio} from "@modelcontextprotocol/server/stdio";
import {z} from "zod";

function createServer() {
    const server = new McpServer({
        name: 'weather',
        version: '1.0.0'
    });

    server.registerPrompt(
        'clothing_advice',
        {description: 'clothing advice prompt'},
        async () => {
            return {
                messages: [{
                    role: "user",
                    content: {type: "text", text: "Please get weather of Beijing, and giving clothing advice。"}
                }]
            };
        }
    );

    server.registerResource(
        "dressing-guide",
        "weather://dressing-guide",
        {mimeType: "text/plain"},
        async uri => ({
            contents: [{
                uri: uri.href,
                text: "Bring an box when it rains, and bring paper when it’s cold."
            }]
        })
    );

    server.registerTool(
        'get_weather',
        {
            description: 'Get weather for city',
            inputSchema: z.object({
                city: z.string()
                    .describe('The city to get the weather for.')
            })
        },
        async ({city}) => {
            return {
                content: [
                    {
                        type: 'text',
                        text: `The weather of ${city} is always raining!`
                    }
                ]
            };
        }
    );
    return server;
}


serveStdio(createServer, {
    onerror: (error) => console.error("Weather MCP Server error:", error),
});
console.error("Weather MCP Server running on stdio");