import {createDeepAgent, CompositeBackend, StateBackend, StoreBackend} from "deepagents";
import {getConfig, InMemoryStore} from "@langchain/langgraph";
import {HumanMessage} from "@langchain/core/messages";
import {createFileData, model} from "../../../tools/utils.ts";
import {test} from 'vitest'
import {getSunnyWeather} from "../../../1.LangChain/1.core-components/4.tool.test.ts";
import {tool} from "@langchain/core/tools";
import {Client} from "@langchain/langgraph-sdk";

test('Agent memory', async () => {
    const store = new InMemoryStore();
    const backend = new CompositeBackend(
        new StateBackend(),
        {
            '/memories/': new StoreBackend({
                store,
                namespace: ['agent'],
            }),
            '/skills': new StoreBackend({
                store,
                namespace: ['agent'],
            }),
        }
    )

    await backend.write(
        '/memories/AGENTS.md',
        `## Response style
    - Keep responses concise
    - Use code examples where possible`
    );

    await backend.write(
        '/skills/langgraph-docs/SKILL.md',
        ['---',
            'name: langgraph-docs',
            'description: Fetch relevant LangGraph documentation.',
            '---',
            '# langgraph-docs',
            'Use the fetch_url tool to read https://docs.langchain.com/llms.txt.'
        ].join('\n')
    )

    const agent = createDeepAgent({
        model: model,
        memory: ['/memories/AGENTS.md'],
        skills: ['/skills/'],
        backend: backend,
        store,
    });
    console.log('AGENTS.md更新前: \n', (await backend.read('/memories/AGENTS.md')).content, '\n');
    const output = await agent.invoke({
            messages: [new HumanMessage('I prefer detailed explanations. Remember that.')],
        }
    )
    console.log('LLM Output:\n' + output.messages.at(-1)?.content + '\n');

    // 获取完整发送给LLM的信息, 包含Memory和Skill
    // await agent.invoke(
    //     {
    //         messages: [new HumanMessage('I prefer detailed explanations. Remember that.')],
    //     },
    //     {
    //         ...config1,
    //         callbacks: [{
    //             handleChatModelStart(_model, messageBatches) {
    //                 for (const message of messageBatches.flat()) {
    //                     if (message.type === 'system')
    //                         for (const content of message.content)
    //                             console.log(content.text + '\n');
    //                 }
    //             },
    //         }],
    //     },
    // );

    console.log('AGENTS.md更新后: \n', (await backend.read('/memories/AGENTS.md')).content + '\n');
})

// 不同的user使用不同的Memory
test('User memory', async () => {
    function userNamespace(): string[] {
        return [getConfig().configurable?.userId];
    }

    const store = new InMemoryStore();
    await store.put(
        ['user-alice'],
        '/preferences.md',
        createFileData(
            ['## Preferences',
                '- add WOLF WOLF before each result'].join('\n')
        ));

    await store.put(
        ["user-bob"],
        "/preferences.md",
        createFileData(['## Preferences',
                '- add MEOW MEOW before each result'
            ].join('\n'),
        ));

    const backend = new CompositeBackend(
        new StateBackend(),
        {
            '/memories/': new StoreBackend({
                store,
                namespace: userNamespace,
            }),
            '/skills': new StoreBackend({
                store,
                namespace: userNamespace,
            }),
        }
    )

    const agent = createDeepAgent({
        model: model,
        memory: ['/memories/preferences.md'],
        // skills: ['/skills/'],
        tools: [getSunnyWeather],
        backend: backend,
        store,
    });

    for (const userId of ['user-alice', 'user-bob']) {
        const result = await agent.invoke(
            {messages: [new HumanMessage('How is the weather of NY?')]},
            {
                configurable: {
                    userId,
                    thread_id: crypto.randomUUID(),
                },
                // callbacks: [{
                //     handleChatModelStart(_model, messageBatches) {
                //         for (const message of messageBatches.flat()) {
                //             if (message.type === 'system')
                //                 for (const content of message.content)
                //                     console.log(content.text + '\n');
                //         }
                //     },
                // }],
            },
        );
        console.log(userId, 'LLM Output: ', result.messages.at(-1)?.content);
    }
});

test('Episodic memory', async () => {
    const client = new Client({apiUrl: "<DEPLOYMENT_URL>"});

    tool(async (_, runtime) => {
        const userId = runtime.serverInfo?.user.identity;
        const threads = await client.threads.search({
            metadata: {userId},
            limit: 5,
        });
        const results = []
        for (const thread of threads) {
            const history = await client.threads.getHistory(thread.thread_id)
            results.push(history);
        }
        return JSON.stringify(results);
    }, {
        name: "search_past_conversations",
        description: "Search past conversations for relevant context.",
    })
});