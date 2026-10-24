import {createAgent, tool} from "langchain";
import {CompiledSubAgent, createDeepAgent, type SubAgent} from "deepagents";
import {z} from "zod";
import {test} from 'vitest';
import {model} from '../../../tools/utils.ts';
import {getSunnyWeather} from "../../../1.LangChain/Code/1.CoreComponents/4.tool.test.ts";
import type {ToolRuntime} from "@langchain/core/tools";
import {HumanMessage} from "@langchain/core/messages";

test('SubAgent', async () => {
    const researchSubagent: SubAgent = {
        name: "research-agent",
        description: "Used to research more in depth questions",
        systemPrompt: "You are a great researcher",
        tools: [getSunnyWeather],
        model: model,
    };
    const subagents = [researchSubagent];

    const agent = createDeepAgent({
        model: "google:gemini-3.6-flash",
        subagents,
    });
});

test('CompiledSubAgent', async () => {
    const researchInstructions = "You are a research coordinator.";
    const yourModel = "google:gemini-3.6-flash";
    const specializedTools: never[] = [];

    const customGraph = createAgent({
        model: yourModel,
        tools: specializedTools,
        systemPrompt: "You are a specialized agent for data analysis...",
    });

    const customSubagent: CompiledSubAgent = {
        name: "data-analyzer",
        description: "Specialized agent for complex data analysis tasks",
        runnable: customGraph,
    };

    const subagents = [customSubagent];

    const agent = createDeepAgent({
        model: "openai:gpt-5.5",
        tools: [getSunnyWeather],
        systemPrompt: researchInstructions,
        subagents: subagents,
    });
});

test('Forked subagents', async () => {
    const readDiff = tool(
        async ({path}: { path: string }) => `diff for ${path}`,
        {
            name: "read_diff",
            description: "Read a file's diff",
            schema: z.object({path: z.string()}),
        },
    );

    const commentWriter = {
        name: "comment-writer",
        description: "Continues an in-progress PR review and drafts review comments",
        mode: "fork" as const,
        tools: [readDiff],
    };

    const agent = createDeepAgent({
        model: "anthropic:claude-sonnet-4-6",
        tools: [readDiff],
        subagents: [commentWriter],
    });

    const result = await agent.invoke({
        messages: [
            {
                role: "user",
                content:
                    "Review PR #482 and hand it off to comment-writer to draft comments for the issues found",
            },
        ],
    });
});

test('SubAgent Access Context', async () => {
    const contextSchema = z.object({
        userId: z.string(),
        sessionId: z.string(),
    });

    const getUserData = tool(
        async (input, runtime: ToolRuntime<unknown, typeof contextSchema>) => {
            // Access Main Agent's Context
            const userId = runtime.context?.userId;
            return `Data for user ${userId}: ${input.query}`;
        },
        {
            name: "get_user_data",
            description: "Fetch data for the current user",
            schema: z.object({query: z.string()}),
        },
    );

    const researchSubagent = {
        name: "researcher",
        description: "Conducts research for the current user",
        systemPrompt: "You are a research assistant.",
        tools: [getUserData],
    };

    const agent = createDeepAgent({
        model: "openai:gpt-5.5",
        subagents: [researchSubagent],
        contextSchema,
    });

    const result = await agent.invoke(
        {messages: [new HumanMessage("Look up my recent activity")]},
        {context: {userId: "user-123", sessionId: "abc"}},
    );
});

test('Which Subagent Called Tool', async () => {
    const sharedLookup = tool(
        async (input, runtime: ToolRuntime) => {
            // 获取调用Tool的Agent的name
            const agentName = runtime.config?.metadata?.lc_agent_name;
            console.log(agentName);
        },
        {
            name: "shared_lookup",
            description: "Look up information from various sources",
            schema: z.object({query: z.string()}),
        },
    );
});

test('My Test', async () => {
    // 1.创建工具, 工具命名使用下划线
    const getProductInfo = tool(
        () =>
            "name\":\"户外徒步休闲鞋\",\"description\":\"适合一般户外步行的鞋款，请按实际路况和穿着需求选择。\\n\\n## 核心参数\\n\\n鞋面：合成革与聚酯网布拼接。\\n\\n外底：橡胶，底纹深约 4 mm。\\n\\n39 码内长：250 mm，建议脚长 240—245 mm。\\n\\n42 码内长：270 mm，建议脚长 260—265 mm。\\n\\n鞋口：低帮，非高帮护踝结构。\\n\\n重量：42 码单只约 360g。\\n\\n测量误差：内长 ±3 mm。\\n\\n边界：适合城市步行和简单步道，不含防水膜、无冰面防滑认证。\\n\\n## 规格选择与差异\\n\\n可选规格：39 码 · 沙色；42 码 · 黑色。\\n\\n39 码 · 沙色与 42 码 · 黑色按尺码和颜色区分。不能用于需要专业技术装备的攀登或涉水。\\n\\n## 使用方法与适用条件\\n\\n1. 先测量本人或常穿合身衣物，再与所选规格逐项比较。成衣尺寸、人体尺寸和建议活动余量不是同一个数字，不只根据身高体重或其他品牌尺码选购。\\n\\n2. 平铺测量时自然放置、不拉伸弹性部位；胸围、腰围在明确标为整圈时按整圈比较。尺码范围是参考条件，不保证所有身形的相同穿着感受。\\n\\n3. 首次穿用前核对面料标签与护理方式，深浅色分开清洗。若需要退换，请保留吊牌、配件及原始状态，是否可退按平台规则和实际材料处理。\\n\\n## 包装与交付范围\\n\\n每份含所选款式 1 件；商品名或规格注明组合装、袜子或鞋类时，按列明件数、双数交付。搭配展示中的其他衣物、饰品与道具不包含在内。\\n\\n## 验收与信息边界\\n\\n收货时核对颜色、尺码、件数与缝线，尺寸问题按同一平铺方式记录卷尺起止位置；避免把测量误差与弹性拉伸量混在一起。\\n\\n没有列出的防晒等级、医疗效果、绝对防滑、防水水压或其他检测结论均未提供。屏幕色差不能用来推定具体实物色号。\\n\\n## 常见问答\\n\\n问：户外徒步休闲鞋的鞋面是什么？\\n\\n答：合成革与聚酯网布拼接\\n\\n问：户外徒步休闲鞋的外底是什么？\\n\\n答：橡胶，底纹深约 4 mm\\n\\n问：两种规格有什么区别？\\n\\n答：39 码 · 沙色与 42 码 · 黑色按尺码和颜色区分。不能用于需要专业技术装备的攀登或涉水。\\n\\n## 交易与售后\\n\\n价格、可售库存、订单状态及退款进度是实时信息，以所选规格和对应订单记录为准，不从固定描述推算。购买时保存商品名称、规格与价格快照；售后请从本人订单提交原因、说明和证据，按平台流程处理。\\n\\n本商品及以上参数均为本平台虚构的演示数据，用于功能测试和问答评估，不对应真实品牌或真实服务承诺。\",\"skus\":[{\"skuId\":\"6898ec57-06d5-406d-b065-269bfd734dc4\",\"stock\":65,\"attributes\":\"39 码 · 沙色\",\"priceCents\":36900},{\"skuId\":\"461e311b-731a-43a1-86fa-0c37af65b098\",\"stock\":76,\"attributes\":\"42 码 · 黑色\",\"priceCents\":42400}],\"currency\":\"CNY\",\"queriedAt\":\"2026-10-20T09:25:40.128Z\"",
        {
            name: 'get_product_info',
            description: '获取鞋的详细信息',
        }
    );
    const agent = createAgent({
        model: model,
        tools: [getProductInfo],
        systemPrompt: '你是一个商城导购, 在回答问题之前, 先使用 `getProductInfo` tool 获取商品的详细信息, 然后进行回答,回答的时候尽量像一个人类一样, 说话自然, 简短一点, 不要说废话'
    });


    const result = await agent.invoke({
        messages: [new HumanMessage('怎么判断这个鞋我能不能穿上?')]
    });
    console.log(result);
});