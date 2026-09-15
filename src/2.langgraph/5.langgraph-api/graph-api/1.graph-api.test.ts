import {test} from 'vitest'
import {
    Command,
    END,
    GraphNode, interrupt, LangGraphRunnableConfig, MemorySaver,
    MessagesValue,
    ReducedValue, Runtime, Send,
    START,
    StateGraph,
    StateSchema, UntrackedValue
} from "@langchain/langgraph";
import * as z from "zod";
import {HumanMessage} from "@langchain/core/messages";
import {tool} from "langchain";

// 输入,输出,以及存储的state，还有节点之间消息传递，
// 都可以使用不同的 scheme。
test('Multi Schema', async () => {
    const InputState = new StateSchema({
        userInput: z.string(),
        Value: MessagesValue
    });

    const OutputState = new StateSchema({
        graphOutput: z.string(),
        value: new ReducedValue(z.string(), {
            reducer: (_: string, right: string) => {
                return right
            }
        })
    })

    const OverallState = new StateSchema({
        foo: z.string(),
        userInput: z.string(),
        graphOutput: z.string(),
    });

    const PrivateState = new StateSchema({
        bar: z.string(),
    });

    const graph = new StateGraph({
        state: OverallState,
        input: InputState,
        output: OutputState
    })
        .addNode("node1", (state) => {
            return {foo: state.userInput + " name"};
        }).addNode("node2", (state) => {
            return {bar: state.foo + " is",};
        }).addNode(
            "node3", (state) => {
                return {graphOutput: state.bar + " Lance"};
            }, {input: PrivateState},
        )
        .addEdge(START, "node1")
        .addEdge("node1", "node2")
        .addEdge("node2", "node3")
        .addEdge("node3", END)
        .compile();

    console.log(await graph.invoke({userInput: "My"}));
})

const BasicSchema = new StateSchema({
    input: z.string(),
    output: z.string(),
})

// GraphNode两种定义方法
const node1: GraphNode<typeof BasicSchema> = async (state, config) => {
    console.log(`input:${state.input}`);
    return {output: state.input}
};

const node2: typeof BasicSchema.Node = async (state) => {
    console.log(`input:${state.input}`);
    return {output: state.input}
}

test('State', async () => {
    const stateSchema = new StateSchema({
        input: z.string(),
        output: z.string().default(''),
        messages: MessagesValue,
        messagesReducer: new ReducedValue(z.array(z.instanceof(HumanMessage)).default(() => []), {
            reducer: (left, right) => left.concat(...right)
        }),
        JDBConnection: new UntrackedValue(z.string()),
    })

    const nodeA: GraphNode<typeof stateSchema> = async (state) => {
        return new Command({
            update: {
                output: state.input,
                messages: [new HumanMessage('abc')],
                messagesReducer: [new HumanMessage('abc')],
                JDBConnection: 'Mysql Connection'
            }
        })
    }

    const nodeB = async (state: typeof stateSchema.State) => {
        console.log('JDBConnection: ' + state.JDBConnection);

        interrupt("Continue?");
        return new Command({
            update: {
                output: state.input,
                messages: [new HumanMessage('def')],
                messagesReducer: [new HumanMessage('def')],
            }
        })
    }

    const graph = new StateGraph(stateSchema)
        .addNode("nodeA", nodeA)
        .addNode("nodeB", nodeB)
        .addEdge(START, "nodeA")
        .addEdge('nodeA', 'nodeB')
        .addEdge("nodeB", END)
        .compile({checkpointer: new MemorySaver()});

    const config = {configurable: {thread_id: crypto.randomUUID()}};
    console.log(await graph.invoke({input: "Hello"}, config));

    console.log(await graph.invoke(new Command({resume: 'yes'}), config));
}, 600_000)

test('Edge', async () => {
    const stateSchema = new StateSchema({
        score: z.number(),
        output: z.string(),
    })

    const nodeA = async (state: typeof stateSchema.State) => {
        if (state.score < 60) return ['nodeB', 'nodeC']
        return 'nodeC'
    }

    const nodeB = async (state: typeof stateSchema.State) => {
        console.log('Hello From NodeB');
    }

    const nodeC = async (state: typeof stateSchema.State) => {
        console.log('Hello From NodeC');
    }

    const graph = new StateGraph(stateSchema)
        .addNode('nodeA', nodeA)
        .addNode('nodeB', nodeB)
        .addNode('nodeC', nodeC)
        .addConditionalEdges(START, nodeA)
        .compile()

    console.log(await graph.invoke({score: 50}));
    // console.log(await graph.invoke({score: 80}));
})

test('Send', async () => {
    const stateSchema = new StateSchema({
        nameList: z.array(z.string()),
        output: MessagesValue,
    })

    const nodeA = (state: typeof stateSchema.State) =>
        state.nameList.map((name) => new Send('nodeB', {name}))

    const nodeB = async ({name}: { name: string }) => {
        console.log(`Hello ${name}`);
        return {}
    }

    const graph = new StateGraph(stateSchema)
        .addNode('nodeA', nodeA)
        .addNode('nodeB', nodeB)
        .addConditionalEdges(START, nodeA)
        .addEdge('nodeB', END)
        .compile()

    console.log(await graph.invoke({nameList: ['Luke', 'Sun', 'william']}));
})

/*
Command用于控制Graph执行。四个参数：
- update：更新State。
- goto：跳转到特定节点。
- graph : 从子图导航时，以父图为目标。
- resume ：提供一个值，在中断后恢复执行。
*/
test('Command', async () => {
    const stateSchema = new StateSchema({
        messages: MessagesValue,
    })

    // 从Node返回Command
    const nodeA = async (state: typeof stateSchema.State) => {
        return new Command({
            update: {
                messages: [new HumanMessage('Hello From nodeA')],
            }
        })
    }

    // 作为`invoke`或`stream`的输入
    const nodeB = async (state: typeof stateSchema.State) => {
        // 接收command resume中的值。
        const answer = interrupt("Do you approve?");
        return {messages: [new HumanMessage('Hello From nodeB')]};
    }

    const graph = new StateGraph(stateSchema)
        .addNode('nodeA', nodeA)
        .addNode('nodeB', nodeB)
        .compile()

    const config = {configurable: {thread_id: crypto.randomUUID()}};
    await graph.invoke({}, config);
    const resumed = await graph.invoke(new Command({resume: "yes"}), config);
    console.log(resumed);

    const routeTool = tool(
        (input) => new Command({
            update: {messages: [new HumanMessage('Hello From routeTool')],},
            goto: 'NodeC'
        })
        , {
            name: 'route_tool',
            description: 'Route to nodeC',
            schema: z.object({
                city: z.string().describe('The city to get the weather for'),
            }),
        }
    );
})

test('Context', async () => {
    const stateSchema = new StateSchema({
        input: z.string(),
        output: z.string(),
    });

    const contextSchema = z.object({
        dbUsername: z.string(),
        dbPassword: z.string(),
        dbUrl: z.string(),
    });

    const nodeA: typeof stateSchema.Node =
        async (state, config: LangGraphRunnableConfig) => {
            console.log(config.context?.dbUrl);
            console.log(config.context?.dbUsername);
            console.log(config.context?.dbPassword);
            return {output: state.input};
        }

    const graph = new StateGraph(stateSchema, contextSchema)
        .addNode("nodeA", nodeA)
        .addEdge(START, "nodeA")
        .addEdge("nodeA", END)
        .compile();

    const config = {context: {dbUsername: "admin", dbPassword: "123456", dbUrl: "mysql"}};
    console.log(await graph.invoke({input: "Hello"}, config));
})
