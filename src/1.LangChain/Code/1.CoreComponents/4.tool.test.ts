import {createAgent, createMiddleware, tool, ToolRuntime} from 'langchain';
import {z} from 'zod';
import {model} from './2.model.test.ts';
import {HumanMessage, ToolMessage} from '@langchain/core/messages';
import {test} from 'vitest';
import {InMemoryStore} from '@langchain/langgraph';
import {Command} from "@langchain/langgraph";

// 1.创建工具, 工具命名使用下划线
export const getSunnyWeather = tool(
    (input) => `It's always sunny in ${input.city}!`
    , {
        name: 'get_weather',
        description: 'Get the weather for a given city',
        schema: z.object({
            city: z.string().describe('The city to get the weather for'),
        }),
    }
);

// 1.创建工具, 工具命名使用下划线
export const getRainingWeather = tool(
    (input) => `It's always Raining in ${input.city}!`
    , {
        name: 'get_raining_weather',
        description: 'This tool is for local test, Do Not Use',
        schema: z.object({
            city: z.string().describe('The city to get the weather for'),
        }),
    }
);

// 2.访问上下文
//   Context: 保存不可变的配置数据
test('Context', async () => {
    const getUserDetailTool = tool(
        ({userId}, config) => {
            return `UserID: ${userId}, Password: ${config.context.password}`
        },
        {
            name: 'get_user_detail',
            description: 'Get user detail by user id',
            schema: z.object({userId: z.string()})
        }
    )

    const myContextSchema = z.object({password: z.string()})

    const agent = createAgent({
        model: model,
        tools: [getUserDetailTool],
        contextSchema: myContextSchema
    });

    const msg = await agent.invoke(
        {messages: [new HumanMessage('Get User Detail where user id is 8')],},
        {context: {password: '123456'}}
    );

    console.log(msg);
})

// Long-Term Memory(Save)
test('Long-Term Memory(Save)', async () => {
    // 有很多种持久化存储实现: PostgresStore、MongoDBStore，RedisStore
    const store = new InMemoryStore();

    const getUserInfo = tool(
        async ({user_id}) => {
            const value = await store.get(['users'], user_id);
            console.log('get_user_info', user_id, value);
            return value;
        },
        {
            name: 'get_user_info',
            description: 'Look up user info.',
            schema: z.object({user_id: z.string(),}),
        }
    );

    const saveUserInfo = tool(
        async ({user_id, name, age, email}) => {
            console.log('save_user_info', user_id, name, age, email);
            await store.put(['users'], user_id, {name, age, email});
            return 'Successfully saved user info.';
        },
        {
            name: 'save_user_info',
            description: 'Save user info.',
            schema: z.object({
                user_id: z.string(),
                name: z.string(),
                age: z.number(),
                email: z.string(),
            }),
        }
    );

    const agent = createAgent({
        model: model,
        tools: [getUserInfo, saveUserInfo],
        store: store,
    });

    let result = await agent.invoke({messages: [new HumanMessage('Save the following user: userid: abc123, name: Foo, age: 25, email: foo@langchain.dev')],});
    result = await agent.invoke({messages: [new HumanMessage("Get user info for user with id 'abc123'")],});
    console.log(result);
}, 600000)


test('Stream writer', async () => {
        const getWeather = tool(
            ({city}, runtime: ToolRuntime) => {
                const writer = runtime.writer;
                runtime

                // Tool执行时, 打印状态更新信息，向用户提供反馈。
                if (writer) {
                    writer(`Looking up data for city: ${city}`);
                    writer(`Acquired data for city: ${city}`);

                    // 访问并打印执行详情
                    const info = runtime.executionInfo;
                    writer(`taskId: ${info.taskId}`);
                    writer(`Attempt: ${info.nodeAttempt}`);

                    // 当程序运行在LangGraph Server上时，
                    // 可通过以下方式访问 assistantId、graphId 和已认证用户
                    const server = runtime.serverInfo;
                    if (server != null) {
                        console.log(`Assistant: ${server.assistantId}, Graph: ${server.graphId}`);
                        if (server.user != null) {
                            console.log(`User: ${server.user.identity}`);
                        }
                    }
                }

                return `It's always sunny in ${city}!`;
            },
            {
                name: "get_weather",
                description: "Get weather for a given city.",
                schema: z.object({city: z.string(),}),
            }
        );

        const agent = createAgent({
            model: model,
            tools: [getWeather],
        });

        const stream = await agent.stream(
            {messages: [{role: "user", content: "How is the weather of New York?"}]},
            {streamMode: ['tasks']},
        );

        for await (const chunk of stream)
            console.log(chunk); // 这里才真正打印
    }
)

test('Tool Return Value', async () => {
    // 返回字符串
    const getWeather = tool(
        ({city}) => `It is currently sunny in ${city}.`, {
            name: "get_weather",
            description: "Get weather for a city.",
            schema: z.object({city: z.string()}),
        });

    // 返回一个Object, Object会被序列化后发送出去
    const getWeatherData = tool(
        ({city}) => ({
            city,
            temperature_c: 22,
            conditions: "sunny",
        }), {
            name: "get_weather_data",
            description: "Get structured weather data for a city.",
            schema: z.object({city: z.string()}),
        },
    );

    // 返回多模态内容
    const captureScreenshot = tool(
        async () => [
            {type: "text", text: "Screenshot of the current page:"},
            {type: "image", url: "https://example.com/page.png"},
        ],
        {
            name: "capture_screenshot",
            description: "Capture a screenshot of the current page.",
            schema: z.object({}),
        }
    );

    // 返回一个命令, 该命令使用update更新状态。
    // 当Tool需要改变Agent的状态时，使用此功能。
    const setLanguage = tool(
        async ({language}, runtime: ToolRuntime) => {
            return new Command({
                update: {
                    preferredLanguage: language,
                    messages: [new ToolMessage({
                        content: `Language set to ${language}.`,
                        tool_call_id: runtime.toolCallId,
                    })
                    ],
                },
            });
        }, {
            name: "set_language",
            description: "Set the preferred response language.",
            schema: z.object({language: z.string()}),
        },
    );

    /* 直接从工具返回
       使用此选项后，Agent会将tool的输出直接打印
       不会发回大模型进行进一步处理。

       1.如果模型在一个步骤中调用了多个工具，只有当所有的 tool 都执行完成时，
         才会输出结果, 而且会输出每一个tool的结果
       2.只有当所有的tool都开启了return_direct，才会直接输出而不是发
         送结果给大模型, 否则仍会将结果发送回模型。
    */
    const getWeather_direct = tool(
        ({city}) => `It is currently sunny in ${city}.`, {
            name: "get_weather",
            description: "Get weather for a city.",
            schema: z.object({city: z.string()}),
            returnDirect: true,
        });
    const agent = createAgent({
        model: model,
        tools: [getWeather_direct],
    });
    const msg = await agent.invoke(
        {messages: [new HumanMessage('How is the weather of New York?')]}
    );
    console.log(msg.messages.at(-1)!.content);
})

// 使用Middleware处理Tool错误。
const handleToolErrors = createMiddleware({
    name: "HandleToolErrors",
    // wrapToolCall 的详细说明在`中间件章节`中
    wrapToolCall: async (request, handler) => {
        try {
            return await handler(request);
        } catch (error) {
            return new ToolMessage({
                content: `Tool error: Please check your input and try again. (${error})`,
                tool_call_id: request.toolCall.id!,
            });
        }
    },
});

// 动态选择工具: 根据身份验证状态、用户权限、对话阶段调整tool list，
// 而不是每次都发送所有Tool。
// 1.仅当满足某些条件时, 才启用高级工具。
const stateBasedTools = createMiddleware({
    name: "StateBasedTools",
    wrapModelCall: (request, handler) => {
        // Read from State: check authentication and conversation length
        const state = request.state as typeof request.state & {
            authenticated?: boolean;
        };
        const isAuthenticated = state.authenticated ?? false;
        const messageCount = state.messages.length;

        let filteredTools = request.tools;

        if (!isAuthenticated) {
            filteredTools = request.tools.filter((t: any) => typeof t.name === "string" &&
                t.name.startsWith("public_"),);
        } else if (messageCount < 5) {
            filteredTools = request.tools.filter((t: any) => typeof t.name === "string" &&
                t.name !== "advanced_search",);
        }

        return handler({...request, tools: filteredTools});
    },
});

// 2.根据用户ID,找出这个用户可以使用的Tools
const contextSchema = z.object({userId: z.string(),});
const storeBasedTools = createMiddleware({
    name: "StoreBasedTools",
    contextSchema,
    wrapModelCall: async (request, handler) => {
        const userId = (request.runtime?.context as { userId?: string } | undefined)?.userId ?? "user-123";

        const runtimeStore = request.runtime?.store as InMemoryStore | undefined;
        const rawFlags = (await runtimeStore?.get(["features"], userId as string,)) as unknown;
        const featureFlags = rawFlags as FeatureFlags | undefined;

        let filteredTools = request.tools;
        if (featureFlags) {
            const enabledFeatures = featureFlags.enabledTools || [];
            filteredTools = request.tools.filter((t) =>
                enabledFeatures.includes(t.name as string)
            );
        }

        return handler({...request, tools: filteredTools});
    },
});

// 3.根据运行时上下文查找用户权限，启用相应的Tool
const contextSchema_ = z.object({userRole: z.string(),});
const contextBasedTools = createMiddleware({
    name: "ContextBasedTools",
    contextSchema_,
    wrapModelCall: (request, handler) => {
        // Read from Runtime Context: get user role
        const userRole = request.runtime.context.userRole;

        let filteredTools = request.tools;

        if (userRole === "admin") {
            // Admins get all tools
        } else if (userRole === "editor") {
            filteredTools = request.tools.filter((t) => t.name !== "delete_data");
        } else {
            filteredTools = request.tools.filter((t) => (t.name as string).startsWith("read_"),);
        }

        return handler({...request, tools: filteredTools});
    },
});

// 在运行时添加Tool，比如可以从MCP服务器加载。
// 需要两个中间件钩子：
// - wrap_model_call: 将动态工具添加到请求中
// - wrap_tool_call: 处理动态添加工具的执行
// A tool that will be added dynamically at runtime
const calculateTip = tool(
    ({billAmount, tipPercentage = 20}) => {
        const tip = billAmount * (tipPercentage / 100);
        return `Tip: $${tip.toFixed(2)}, Total: $${(billAmount + tip).toFixed(2)}`;
    },
    {
        name: "calculate_tip",
        description: "Calculate the tip amount for a bill",
        schema: z.object({
            billAmount: z.number().describe("The bill amount"),
            tipPercentage: z.number().default(20).describe("Tip percentage"),
        }),
    }
);

const dynamicToolMiddleware = createMiddleware({
    name: "DynamicToolMiddleware",
    wrapModelCall: (request, handler) => {
        // Add dynamic tool to the request
        // This could be loaded from an MCP server, database, etc.
        return handler({
            ...request,
            tools: [...request.tools, calculateTip],
        });
    },
    wrapToolCall: (request, handler) => {
        if (request.toolCall.name === "calculate_tip")
            return handler({...request, tool: calculateTip});
        return handler(request);
    },
});
