import {test} from 'vitest';
import {
    END,
    GraphDrained,
    MemorySaver,
    RunControl,
    Runtime,
    START,
    StateGraph,
    StateSchema
} from "@langchain/langgraph";
import {z} from "zod";
import {sleep} from "../../../tools/utils.ts";


test('retries demo', async () => {
    const stateSchema = new StateSchema({
        cnt: z.number()
    });

    // nodeA尝试3次
    const nodeA: typeof stateSchema.Node = (state) => {
        if (state.cnt < 3) {
            console.log(`state.cnt = ${state.cnt}, less than 3`);
            state.cnt += 1
            throw Error('Cnt is less than 3')
        }

        return {};
    }

    const graph = new StateGraph(stateSchema)
        .addNode('nodeA', nodeA, {retryPolicy: {maxAttempts: 3}})
        .addEdge(START, 'nodeA')
        .addEdge('nodeA', END)
        .compile()

    const output = await graph.invoke({cnt: 1});
    console.log(output);
})

test('ExecutionInfo', async () => {
    const stateSchema = new StateSchema({});

    const nodeA = (state: typeof stateSchema.State, runtime: Runtime<typeof stateSchema>) => {
        if (runtime.executionInfo?.nodeAttempt ?? 1 > 1)
            return {};
        return {};
    }
})


test('Timeout Demo', async () => {
    const stateSchema = new StateSchema({});

    const nodeA: typeof stateSchema.Node = async (state) => {
        while (1) {
            console.log("NodeA")
            await sleep(1000);
        }

        return {};
    }

    const graph = new StateGraph(stateSchema)
        .addNode('nodeA', nodeA, {timeout: 10000})
        // 等价于
        // .addNode('nodeA', nodeA, {timeout: {runTimeout: 10000}})
        .addEdge(START, 'nodeA')
        .addEdge('nodeA', END)
        .compile()

    const output = await graph.invoke({});
    console.log(output);
}, 600_000)

test('IdleTimeout Demo', async () => {
    const stateSchema = new StateSchema({
        cnt: z.number()
    });

    const nodeA: typeof stateSchema.Node = async (state) => {
        const sleepMs = 1000 * state.cnt;
        console.log(`NodeA ${state.cnt}st execute, sleep ${sleepMs} ms`)
        await sleep(sleepMs);

        return {cnt: state.cnt + 1};
    }

    const graph = new StateGraph(stateSchema)
        .addNode('nodeA', nodeA, {timeout: {idleTimeout: 3000}})
        .addEdge(START, 'nodeA')
        .addEdge('nodeA', 'nodeA')
        .compile()

    const output = await graph.invoke({cnt: 1});
    console.log(output);
}, 600_000)

test('IdleTimeout not timeout Demo', async () => {
    const stateSchema = new StateSchema({
        result: z.string()
    });

    // 持续报告进展, nodeA执行5000ms也不会超时
    const nodeA = async (state: typeof stateSchema.State, runtime: Runtime) => {
        const timer = setInterval(() => {
            runtime.writer?.("后台：还在等待……");
        }, 1000);

        try {
            await sleep(5000);
            return {result: "完成"};
        } finally {
            clearInterval(timer);
        }
    }

    const graph = new StateGraph(stateSchema)
        .addNode('nodeA', nodeA,
            {timeout: {idleTimeout: 2000}})
        .addEdge(START, 'nodeA')
        .addEdge('nodeA', END)
        .compile()

    const output = await graph.invoke({});
    console.log(output);
}, 600_000)

test('refreshOn: heartbeat Demo', async () => {
    const stateSchema = new StateSchema({
        result: z.string()
    });

    const nodeA = async (state: typeof stateSchema.State, runtime: Runtime) => {
        const timer = setInterval(() => {
            // 设置refreshOn: 'heartbeat',
            // 只有手动调用runtime.heartbeat?.();才能重置计时器
            // 即使调用runtime.writer输出数据,也会超时
            runtime.writer?.("后台：还在等待……");
            // runtime.heartbeat?.();
        }, 1000);

        try {
            await sleep(6000);
            return {result: "完成"};
        } finally {
            clearInterval(timer);
        }
    }

    const graph = new StateGraph(stateSchema)
        .addNode('nodeA', nodeA, {
            timeout: {idleTimeout: 3000, refreshOn: 'heartbeat'}
        })
        .addEdge(START, 'nodeA')
        .addEdge('nodeA', END)
        .compile()

    const output = await graph.invoke({});
    console.log(output);
}, 600_000)


test('Graceful shutdown', async () => {
    const stateSchema = new StateSchema({})

    const runControl = new RunControl();

    const nodeA: typeof stateSchema.Node = async () => {
        console.log("NodeA")
        //100ms后请求停止
        setTimeout(() => {
            console.log("请求停止");
            runControl.requestDrain("demo");
        }, 100);
    }

    const nodeB: typeof stateSchema.Node = async () => {
        console.log("NodeB")
        await sleep(1000)
        console.log("NodeB Complete")
    }

    const nodeC: typeof stateSchema.Node = async () => {
        console.log("NodeC")
    }

    const graph = new StateGraph(stateSchema)
        .addNode('nodeA', nodeA)
        .addNode('nodeB', nodeB)
        .addNode('nodeC', nodeC)
        .addEdge(START, 'nodeA')
        .addEdge('nodeA', 'nodeB')
        .addEdge('nodeB', 'nodeC')
        .addEdge('nodeC', END)
        .compile({checkpointer: new MemorySaver()})

    const config = {configurable: {thread_id: "demo-1"}};

    try {
        await graph.invoke({}, {...config, control: runControl});
    } catch (e) {
        if (!(e instanceof GraphDrained)) throw e;
        console.log("已停止：", e.reason);
    }

    console.log("恢复运行");
    await graph.invoke(null, config);
})

test('Listen SIGTERM', async () => {
    const control = new RunControl();
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // 收到终止信号时，请求 Drain
    process.on("SIGTERM", () => {
        console.log("收到 SIGTERM，请求停止");
        control.requestDrain("sigterm");
    });


    // 运行 0.5 秒后，向当前进程发送终止信号
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 500);

    for (let step = 1; step <= 3; step++) {
        // 模拟在每个Node开始前检查 Drain
        if (control.drainRequested) {
            console.log(`停止后续步骤，原因：${control.drainReason}`);
            return;
        }

        console.log(`步骤 ${step} 开始`);
        await sleep(1000);
        console.log(`步骤 ${step} 完成`);
    }
});

const State = new StateSchema({
    input: z.string(),
    output: z.string()
});

const subgraphBuilder = new StateGraph(State)
    .addNode("subNode1", (state) => {
        const msg = `hello ${state.input} from subNode1`
        console.log(msg);
        return {output: msg};
    })
    .addNode("subNode2", (state) => {
        const msg = `hello ${state.input} from subNode2`
        console.log(msg);
        return {output: msg};
    })
    .addNode("subNode3", (state) => {
        const msg = `hello ${state.input} from subNode3`
        console.log(msg);
        return {output: msg};
    })
    .addEdge(START, 'subNode1')
    .addEdge('subNode1', "subNode2")
    .addEdge('subNode2', "subNode3")
    .addEdge('subNode3', END)

const graphBuilder = (subgraph: ReturnType<typeof subgraphBuilder.compile>) =>
    new StateGraph(State)
        .addNode('node1', (state) => {
            const msg = `hello ${state.input} from node1`
            // console.log(msg);
            return {output: msg};
        })
        .addNode('node2', subgraph)
        .addNode('node3', (state) => {
            const msg = `hello ${state.input} from node3`
            // console.log(msg);
            return {output: msg};
        })
        .addEdge(START, "node1")
        .addEdge('node1', 'node2')
        .addEdge('node2', "node3")
        .addEdge('node3', END)

test('List all checkpoints', async () => {
    const checkpointer = new MemorySaver();
    const subgraph = subgraphBuilder
        .compile({
            checkpointer: true,
            interruptBefore: ['subNode2']
        });
    const graph = graphBuilder(subgraph)
        .compile({checkpointer: checkpointer});

    const config = {configurable: {thread_id: "demo"}};
    await graph.invoke({input: 'origin'}, config);

    console.log('interrupt');

    const states = [];
    for await (const state of graph.getStateHistory(config))
        states.push(state);
    console.log(JSON.stringify(states));

    const items = []
    for await (const item of checkpointer.list(config))
        items.push(item);
    console.log(JSON.stringify(items));
});

export const testSubgraphTimetravel = async () => {
    const checkpointer = new MemorySaver();
    const subgraph = subgraphBuilder
        .compile({
            checkpointer: true,
            interruptBefore: ['subNode2']
        });
    const graph = graphBuilder(subgraph)
        .compile({checkpointer: checkpointer});

    const config = {configurable: {thread_id: "demo"}};
    await graph.invoke({input: 'origin'}, config);

    console.log('interrupt');

    const childState = await graph.getState({
        configurable: {
            ...config.configurable,
            checkpoint_ns: "node2"
        }
    });

    const forkConfig = await graph.updateState(childState.config, {input: 'forked'});
    const output = await graph.invoke(null, forkConfig);
    console.log(output);
}

test('Time travel with subgraph', testSubgraphTimetravel)