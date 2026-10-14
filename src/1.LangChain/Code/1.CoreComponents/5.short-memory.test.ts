import {Command, MemorySaver, REMOVE_ALL_MESSAGES, StateSchema} from "@langchain/langgraph";
import {HumanMessage, RemoveMessage, ToolMessage} from "@langchain/core/messages";
import {test} from 'vitest'
import {
    createAgent,
    createMiddleware,
    dynamicSystemPromptMiddleware,
    summarizationMiddleware,
    tool,
    ToolRuntime
} from "langchain";
import {model} from "./2.model.test.ts";
import {z} from "zod";

// 向Agent传入不同的config, 其中包含不同的thread_id
// 传入thread ID, 可获取对应的聊天历史
test("Basic Short Memory", async () => {
    const agent = createAgent({
        model: model,
        tools: [],
        // 生产环境中可使用由数据库实现的checkpointer
        // PostgresSaver etc...
        checkpointer: new MemorySaver(),
    });

    const config1 = {configurable: {thread_id: crypto.randomUUID()}};
    const config2 = {configurable: {thread_id: crypto.randomUUID()}};

    await agent.invoke(
        {messages: [{role: "user", content: "My name is Luke and my age is 66"},],},
        config1,
    );

    await agent.invoke(
        {messages: [{role: "user", content: "My name is Zebra and my age is 88"},],},
        config2,
    );

    // 观察同一个问题, 回答不同
    let result = await agent.invoke(
        {messages: [new HumanMessage('What is my name and my age?')]},
        config1,
    );
    console.log(result.messages.at(-1)?.content)

    result = await agent.invoke(
        {messages: [new HumanMessage('What is my name and my age?')]},
        config2,
    );
    console.log(result.messages.at(-1)?.content)
})

// state: 在middleware中指定state可以用于临时保存状态数据
test("State Demo", async () => {
    const MyState = new StateSchema({
        name: z.string(),
    });

    // 在middleware中访问state。
    const middleware = createMiddleware({
        name: "PrintName",
        stateSchema: MyState,

        beforeModel: (state) => {
            console.log("before " + state.name);
        },

        afterModel: (state) => {
            console.log("after " + state.name);
        },
    });

    // 在tool中可通过runtime访问state
    // 还可通过runtime和Command修改state
    // Command命令是发送给LangChain的，不会发给大模型.
    const getUsername = tool(
        async (_, runtime: ToolRuntime<typeof MyState.State>) => {
            const username = runtime.state.name;
            return new Command({
                update: {
                    name: 'Alice' + username,
                    messages: [
                        new ToolMessage({
                            content: 'Name is' + username,
                            tool_call_id: runtime.toolCall?.id ?? "",
                        }),
                    ]
                }
            })
        },
        {
            name: "get_user_name",
            description: "Get user name",
            schema: z.object({}),
        }
    );

    const agent = createAgent({
        model: model,
        tools: [getUsername],
        middleware: [middleware],
    });

    await agent.invoke({
        messages: [{role: 'human', content: '你好'}],
        name: "Agent State",
    });
})

/*
 裁剪消息, 启用短期消息后，长对话会超出大模型的上下文窗口。有以下解决方案
   1. 移除其中一些消息(trim message)
   2. 删除消息
   3. 消息摘要: 用大模型对历史消息进行总结压缩
   4. 自定义策略: 通过middleware的before model自定义操作messages
*/
test('trim message demo', async () => {
    // 只保留第一条和最后4条消息
    const trimMessages = createMiddleware({
        name: "TrimMessages",
        beforeModel: (state) => {
            const messages = state.messages;
            if (messages.length <= 3) return;

            const newMessages = [messages[0], ...messages.slice(-4)];
            return {
                messages: [
                    // Remove message 是给 launching 看的，不会发送给大模型
                    // 作用是删掉存储的所有消息。
                    new RemoveMessage({id: REMOVE_ALL_MESSAGES}),
                    ...newMessages,
                ],
            };
        },
    });

    // 删掉最开始的两条消息
    const deleteMessages = createMiddleware({
        name: "DeleteMessages",
        beforeModel: (state) => {
            const messages = state.messages;
            if (messages.length > 2) {

                return {
                    messages: messages
                        .slice(0, 2)
                        .map((m) => new RemoveMessage({id: m.id!})),
                };
            }
        },
    });


    // 消息摘要
    const agent = createAgent({
        model: model,
        tools: [],
        middleware: [
            // LangChain自带的消息摘要函数
            summarizationMiddleware({
                model: model,
                trigger: {tokens: 4000},
                keep: {messages: 20},
            }),
        ],
        checkpointer: new MemorySaver(),
    });
})

// 根据context的消息动态调整system prompt
test('dynamic adjust system prompt', async () => {
    const contextSchema = z.object({userName: z.string()});
    const adjustSystemPromptMiddleware =
        dynamicSystemPromptMiddleware<z.infer<typeof contextSchema>>((_, config) => {
            return `You are a helpful assistant. Address the user as ${config.context?.userName}.`;
        })
})
