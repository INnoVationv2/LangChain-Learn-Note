import {AIMessage, createAgent, createMiddleware, humanInTheLoopMiddleware, initChatModel, Tool} from "langchain";
import {z} from 'zod';
import {test} from 'vitest';
import {model} from "../1.core-components/2.model.test";
import {getWeather} from "../1.core-components/4.tool.test";
import {HumanMessage, ToolMessage} from "@langchain/core/messages";
import {Command, InMemoryStore} from "@langchain/langgraph";
import {unthinkingModel} from "../../tools/utils";
/*
Middleware的作用
- 通过日志记录, 分析和调试来跟踪Agent行为
- 修改Prompt, tool list, output format
- 添加重试、回退和提前终止逻辑
- 应用速率限制、防护措施和个人身份信息检测。
* */

// 创建一个在执行对应tool时，会停止执行等待人工确认的middleware
// readEmail/sendEmail are registered with name:read_email/send_email
const emailAgent = createAgent({
    model: "claude-sonnet-4-6",
    tools: [getWeather],
    middleware: [humanInTheLoopMiddleware({
        interruptOn: {get_weather: true}
    })],
});

// 这节展示有多个middleware时, 执行的顺序
test('Middleware Lifecycle Demo', async () => {
    const middleware = (name: string) => createMiddleware({
        name: name,
        beforeAgent: (state, runtime) => {
        },
        beforeModel: (state, runtime) => {
        },
        afterModel: (state, runtime) => {
        },
        afterAgent: (state, runtime) => {
        },
        wrapModelCall: async (request, handler) => {
            return handler(request);
        },
        wrapToolCall: async (request, handler) => {
            console.log(`${name}: Before Tool Call`);
            const output = await handler(request);
            console.log(`${name}: After Tool Call`);
            return output;
        },
    })

    const agent = createAgent({
        model: model,
        tools: [getWeather],
        middleware: [
            middleware('middleware-1'),
            middleware('middleware-2')
        ]
    })

    for await (const [streamMode, msg] of await agent.stream(
        {messages: new HumanMessage('How if the weather of NY?')},
        {streamMode: ['updates']}))
        console.log(`${streamMode}: ` + JSON.stringify(msg));
}, 600_000)

// 这节展示可以通过state和runtime做什么事情
test('Middleware Demo 2', async () => {
    const countSchema = z.object({count: z.number()})
    const middleware = createMiddleware({
        name: 'middleware',
        stateSchema: countSchema,
        contextSchema: countSchema,
        beforeAgent: async (state, runtime) => {
            // 1.state
            // 1.1 State变量操作
            console.log(`State.Count: ${state.count}`);
            state.count += 1
            console.log(`State.Count: ${state.count}`);
            // 1.2 获取Message List
            const messages = state.messages
            console.log(`Messages Size: ${messages.length}`);
            state.messages.push(new HumanMessage('My name is Luke and my age is 88'));
            // 1.3 删除index为1的Message
            // state.messages.splice(1, 1)

            // 2.runtime
            // 2.1 Context变量是只读的
            console.log(`Runtime.Count: ${state.count}`);
            // 2.2 writer 通过runtime的writer向主Agent发送消息
            //     Agent可通过streamMode: 'custom'接收消息
            const writer = runtime.writer
            if (writer) writer('Hello From middleware_2 Writer');
            // 2.3 Store(Long Term Memory)
            const store = runtime.store
            if (store) {
                // 三个变量分别是namespace、key和value。
                await store.put(['namespace-1'], '123', {'name': 'Alice'});
                const value = store.get(['namespace-1'], '123')
                console.log(`Store Value: ${value}`);
            }

            // 2.4
            // 读取配置, 不能修改
            const config = runtime.configurable;
            console.log(`Agent Config: ${JSON.stringify(config)}`);

            // 2.5 获取执行信息
            const serverInfo = runtime.serverInfo
            const executionInfo = runtime.executionInfo
            console.log(`ServerInfo : ${JSON.stringify(serverInfo)}`);
            console.log(`Execution Info : ${JSON.stringify(executionInfo)}`);
        },
        beforeModel: (state, runtime) => {
        },
        afterModel: (state, runtime) => {
        },
        afterAgent: (state, runtime) => {
        },
        wrapModelCall: (request, handler) => {
            console.log(`Before Call Model`);
            const output = handler(request);
            console.log(`After Call Model`);
            return output;
        }
    })

    const agent = createAgent({
        model: model,
        middleware: [middleware],
        stateSchema: countSchema,
        contextSchema: countSchema,
        store: new InMemoryStore(),
    })

    const output = await agent.stream(
        {
            messages: [new HumanMessage("What's my name and age?")],
            count: 666
        },
        {context: {count: 888}, streamMode: ['updates', 'values', 'custom']})
    for await (const [streamMode, msg] of output) {
        if (streamMode === 'custom' || streamMode === 'updates')
            console.log(`Main Agent[${streamMode}]: ` + JSON.stringify(msg));
        else
            console.log(`Main Agent[${streamMode}]: ` + JSON.stringify(msg.messages.at(-1)!.content));
    }
}, 600_000)

// 这节展示Command:
//    update: 可更新state里的所有变量。
test("Middleware Demo 3", async () => {
    // 自定义Middleware
    const middleware = createMiddleware({
        name: 'middleware',
        stateSchema: z.object({count: z.number()}),
        contextSchema: z.object({name: z.string()}),
        beforeAgent: (state, runtime) => {
            console.log(`State.count: ${state.count}`)
            console.log(`runtime.name: ${runtime.context.name}`)
        },
        beforeModel: (state, runtime) => {
        },
        afterModel: (state, runtime) => {
        },
        afterAgent: (state, runtime) => {
            console.log(`State.count: ${state.count}`)
            console.log(`runtime.name: ${runtime.context.name}`)
        },
        wrapModelCall: async (request, handler) => {
            const output = await handler(request);
            return new Command({
                update: {
                    count: 888,
                    // 尝试更新context.name，会发现name不变
                    name: 'Alice',
                    messages: [
                        output,
                        new HumanMessage({content: 'Answer: Your name is Luke and my age is 88'})]
                }
            })
        }
    })

    const agent = createAgent({
        model: model,
        middleware: [middleware],
        stateSchema: z.object({count: z.number()}),
        contextSchema: z.object({name: z.string()})
    })

    const output = await agent.invoke(
        {
            messages: [new HumanMessage("What's my name and age?")],
            count: 0
        },
        {context: {name: 'Luke'}}
    )

    console.log('Message list:');
    output.messages.forEach(msg => console.log('  ' + msg.content));
})

// model 跳到模型节点，用当前state中的消息再次调用模型
// tools 跳到工具节点，执行当前AIMessage中tool_calls
// end   跳转到Agent执行的末尾(或第一个after_agent())
// 名字最前面加了下划线的变量，只能在Agent内部访问。
// 不会暴露给调用者
test('JumpTo Demo', async () => {
    const CustomState = z.object({
        publicCounter: z.number().default(0),
        _modelCallCount: z.number().default(0),
    });

    const middleware = createMiddleware({
        name: 'middleware',
        stateSchema: CustomState,
        beforeModel: {
            canJumpTo: ['end'],
            hook: (state) => {
                // 限制调用次数
                if (state._modelCallCount > 10)
                    return {jumpTo: 'end'}
                return
            }
        },
        afterModel: (state) => {
            state._modelCallCount++
            return {modelCallCount: state._modelCallCount + 1}
        },
    })

    const agent = createAgent({
        model: model,
        middleware: [middleware],
        stateSchema: CustomState,
    })

    const result = await agent.invoke({
        messages: [new HumanMessage("Hello")],
        publicCounter: 0
    });

    console.log(result.publicCounter);
    console.log(result._modelCallCount); //undefined
})

// Middleware使用案例
// 1.动态System Prompt
const addContextMiddleware = createMiddleware({
    name: "AddContextMiddleware",
    wrapModelCall: async (request, handler) => {
        return handler({
            ...request,
            systemMessage: request.systemMessage.concat(`Additional context.`),
        });
    },
});

// 2.动态选择Model
const models = {
    complex: model,
    simple: unthinkingModel,
};
const dynamicModelMiddleware = createMiddleware({
    name: "DynamicModelMiddleware",
    wrapModelCall: (request, handler) => {
        const modifiedRequest = {...request};
        if (request.messages.length > 10)
            modifiedRequest.model = models.complex;
        else
            modifiedRequest.model = models.simple;
        return handler(modifiedRequest);
    },
});

// 3.修改Tool List
const toolSelectorMiddleware = createMiddleware({
    name: "ToolSelector",
    wrapModelCall: (request, handler) => {
        const relevantTools: Tool[] = [];
        const modifiedRequest = {...request, tools: relevantTools};
        return handler(modifiedRequest);
    },
});

//动态选择回复格式
const simpleResponse = z.object({
    answer: z.string().describe("A brief answer"),
});
const detailedResponse = z.object({
    answer: z.string().describe("A detailed answer"),
    reasoning: z.string().describe("Explanation of reasoning"),
    confidence: z.number().describe("Confidence score 0-1"),
});
const stateBasedOutput = createMiddleware({
    name: "StateBasedOutput",
    wrapModelCall: (request, handler) => {
        const messageCount = request.messages.length;

        let responseFormat;
        if (messageCount < 3) responseFormat = simpleResponse;
        else responseFormat = detailedResponse;

        return handler({...request, responseFormat});
    },
});

// 4.Tool调用监控
const toolMonitoringMiddleware = createMiddleware({
    name: "ToolMonitoringMiddleware",
    wrapToolCall: (request, handler) => {
        console.log(`Executing tool: ${request.toolCall.name}`);
        console.log(`Arguments: ${JSON.stringify(request.toolCall.args)}`);
        try {
            const result = handler(request);
            console.log("Tool completed successfully");
            return result;
        } catch (e) {
            console.log(`Tool failed: ${e}`);
            throw e;
        }
    },
});





