import {test} from 'vitest'
import {
    MemorySaver,
    START,
    StateGraph,
    StateSchema,
} from "@langchain/langgraph";
import {z} from "zod";
import {testSubgraphTimetravel} from "./3.fault-tolerance.test.ts";

test('Call a subgraph inside a node', async () => {
    const subgraphState = new StateSchema({
        subState: z.string(),
    });

    const subgraph = new StateGraph(subgraphState)
        .addNode("subgraphNode1", (state) => {
            return {bar: "hi! " + state.subState};
        })
        .addEdge(START, "subgraphNode1")
        .compile();


    const State = new StateSchema({
        state: z.string(),
    });

    const graph = new StateGraph(State)
        .addNode("node1", async (state) => {
            const subgraphOutput = await subgraph.invoke({subState: state.state});
            return {graphState: subgraphOutput.subState};
        })
        .addEdge(START, "node1")
        .compile();

    const output = await graph.invoke({});

    console.log(output);
})

test('add a subgraph as a node', async () => {
    const State = new StateSchema({
        foo: z.string(),
    });

    const subgraph = new StateGraph(State)
        .addNode("subgraphNode1", (state) => {
            return {foo: "hi! " + state.foo};
        })
        .addEdge(START, "subgraphNode1")
        .compile();

    const graph = new StateGraph(State)
        .addNode("node1", subgraph)
        .addEdge(START, "node1")
        .compile();
})

test('Time travel with subgraph', testSubgraphTimetravel)