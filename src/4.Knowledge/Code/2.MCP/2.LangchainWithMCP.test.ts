import {test} from 'vitest';
import {MCPAdapter, MCPClientError, OAuthClientProvider, UnauthorizedError} from "@langchain/mcp-adapters";
import {createAgent, humanInTheLoopMiddleware, InterruptOnConfig, WhenPredicate} from "langchain";
import {model} from "../../../tools/utils.ts";
import {HumanMessage} from "@langchain/core/messages";
import {DynamicStructuredTool} from "@langchain/core/tools";
import {ToolAnnotations} from "@modelcontextprotocol/server";
import {MemorySaver} from "@langchain/langgraph";
import {randomUUID} from "node:crypto";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/client";

test('LangGraph Connect MCP', async () => {
    const adapter = new MCPAdapter({
        servers: {
            weatherMCP: {
                transport: 'stdio',
                command: 'node',
                args: ['/Users/liuyu/work/langchain_learn/src/4.Knowledge/Code/2.MCP/1.MCPServer.ts']
            },
            LangChainDocMCP: {
                url: "https://docs.langchain.com/mcp"
            }
        }
    });

    try {
        var toolSet = await adapter.listToolsets();

        const tools = await adapter.listTools();
        const agent = createAgent({model: model, tools});
        const result = await agent.invoke({
            messages: [new HumanMessage('How it the weather of Beijing?')]
        });
        console.log(result.messages.at(-1)?.text);
    } finally {
        await adapter.close();
    }
});

function isDestructive(tool: DynamicStructuredTool): Boolean {
    const annotations = tool.metadata?.annotations as ToolAnnotations | undefined;
    return annotations?.destructiveHint ?? false;
}

// 人工审批具有destructiveHint标注的工具
async function getDestructiveTools(serverUrl: string) {
    const adapter = new MCPAdapter({servers: {crm: {url: serverUrl}}});
    const tools = await adapter.listTools();

    const destructive = new Set(tools.filter(isDestructive)
        .map((tool) => tool.name));

    const needsApproval: WhenPredicate = (request) =>
        destructive.has(request.toolCall.name);

    const gate: InterruptOnConfig = {
        allowedDecisions: ['approve', 'reject'],
        when: needsApproval
    };

    const interruptOn = Object.fromEntries(
        tools.map((tool) => [tool.name, gate])
    );

    const agent = createAgent({
        model: model,
        tools,
        middleware: [humanInTheLoopMiddleware({interruptOn})],
        checkpointer: new MemorySaver()
    });

    return {agent, adapter};
}

// 验证令牌
class TokenStore {
    token = '';

    // 获取最新的验证Token
    getToken() {
        return this.token;
    }

    // 刷新token并报告是否刷新成功
    async refreshToken() {
        this.token = randomUUID();
        return true;
    }
}

const tokenStore = new TokenStore();
new MCPAdapter({
    servers: {
        search: {
            url: 'https://search.example.com/mcp',
            headers: {
                Authorization:
                    `Bearer ${process.env.SEARCH_API_KEY}`
            },
        },
        crm: {
            url: 'https://crm.example.com/mcp',
            authProvider: {
                token: async () => tokenStore.getToken(),
                onUnauthorized: async () => {
                    if (!(await tokenStore.refreshToken()))
                        throw new UnauthorizedError("No newer token for the CRM server");
                }
            }
        }
    }
});

test('Session Helper', async () => {
    // 创建支持OAuth授权的MCP连接。
    function createMcpSession(
        serverUrl: string,
        userId: string,
        sessionId: string,
        authProvider: OAuthClientProvider
    ) {
        // 授权校验值, 登录地址
        let pendingState: string | undefined;
        let authorizationUrl: URL | undefined;

        // 生成并保存OAuth state，用于校验授权回调，防止请求被伪造。
        authProvider.state = () => (pendingState = randomUUID());
        // 保存授权地址，交给调用方引导用户登录；这里不会执行页面跳转。
        authProvider.redirectToAuthorization = (url) => {
            authorizationUrl = url;
        };

        const adapter = new MCPAdapter({
            servers: {crm: {url: serverUrl, authProvider}}
        });

        // 检查当前错误及最多三层cause，判断是否是未授权错误
        function causedByUnauthorized(error: unknown): boolean {
            let current: unknown = error;

            for (let depth = 0; depth <= 3; depth += 1) {
                if (UnauthorizedError.isInstance(current))
                    return true;
                if (!(current instanceof Error))
                    return false;
                current = current.cause;
            }
            return false;
        }

        async function listTools() {
            if (authorizationUrl) return {authorizationUrl};

            try {
                return {tools: await adapter.listTools()};
            } catch (error) {
                if (MCPClientError.isInstance(error) &&
                    causedByUnauthorized(error) &&
                    authorizationUrl) {
                    return {authorizationUrl};
                }
                throw error;
            }
        }

        // 处理OAuth回调：校验用户、会话和state,完成授权后获取工具。
        async function completeLogin(
            callbackUrl: URL,
            callbackUserId: string,
            callbackSessionId: string,
        ) {
            const params = callbackUrl.searchParams;
            // 确保回调属于发起授权的用户和会话，且state一致。
            if (callbackUserId !== userId ||
                callbackSessionId !== sessionId ||
                !pendingState ||
                params.get('state') !== pendingState) {
                throw new Error('Invalid OAuth callback');
            }

            // 消耗本次 state，防止同一个回调被重复使用。
            pendingState = undefined;
            const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
                authProvider,
            });

            try {
                await transport.finishAuth(params);
            } catch {
                authorizationUrl = undefined;
                await transport.close();
            }
            return listTools();
        }

        return {listTools, completeLogin, close: () => adapter.close()};
    }

    const crm = createMcpSession(
        'https://crm.example.com/mcp',
        userId,
        sessionId,
        authProvider
    );
    const result = await crm.listTools();
});