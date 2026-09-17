# 2. Thinking in LangGraph

具体代码在

本节以邮件客服为案例，从需求分析一直讲到具体实现。 详细阐述了Lang Graph的设计理念
## 2.1 需求

```
The agent should:
- Read incoming customer emails
- Classify them by urgency and topic
- Search relevant documentation to answer questions
- Draft appropriate responses
- Escalate complex issues to human agents
- Schedule follow-ups when needed

Example scenarios to handle:
1. Simple product question: "How do I reset my password?"
2. Bug report: "The export feature crashes when I select PDF format"
3. Urgent billing issue: "I was charged twice for my subscription!"
4. Feature request: "Can you add dark mode to the mobile app?"
5. Complex technical issue: "Our API integration fails intermittently with 504 errors"
```

### 2.2 根据需求确定执行流程

<img src="http://pic-save-fury.oss-cn-shanghai.aliyuncs.com/uPic/image-20260913152829102.png" alt="image-20260913152829102" style="zoom: 33%;" />

每个节点的功能如下

- `Read Email`提取并解析电子邮件内容
- `Classify Intent`使用 LLM 对紧急程度和主题进行分类，然后路由到相应的行动。
- `Doc Search`查询知识库以获取相关信息
- `Bug Track`在跟踪系统中创建或更新问题
- `Draft Reply`：生成适当的回应
- `Human Review`：上报人工处理或审批。
- `Send Reply`：发送邮件回复

## 2.3 节点分类

在Long Graph中，可分为4类节点。

| 步骤             | 使用时机                               |
| ---------------- | -------------------------------------- |
| LLM Steps        | 需要理解、分析、生成文本或做出推理决策 |
| Data Steps       | 需要从外部来源检索信息                 |
| Action Steps     | 需要执行外部操作                       |
| User Input Steps | 需要人工干预                           |

根据上述节点类型，我们对前面的需求进行分类。

1. `LLM Steps`
   - `Classify intent`:
     - 静态上下文(Prompt)：分类类别、紧急程度定义、响应格式
     - 动态上下文(State)：电子邮件内容、发件人信息
     - 预期结果：确定路由的结构化分类
   - `Draft reply`:
     - 静态上下文(Prompt)：语气准则、公司政策、回复模板
     - 动态上下文(State)：分类结果、搜索结果、客户历史记录
     - 预期结果：可供审核的专业电子邮件回复
2. `Data Steps`
   - `Document search`:
     - 参数：根据意图和主题构建的查询
     - 重试策略：是，采用指数退避策略来应对瞬态故障。
     - 缓存：可以缓存常用查询以减少 API 调用次数。
   - `Customer history lookup`
     - 参数：根据意图和主题构建的查询
     - 重试策略：是，采用指数退避策略来应对瞬态故障。
     - 缓存：可以缓存常用查询以减少 API 调用次数。
3. `Action Steps`
   - `Send reply`:
     - 节点执行时间：审批通过后（人工或自动审批）。
     - 重试策略：是，针对网络问题采用指数退避策略。
     - 不应缓存：每次发送都是一个独立的操作。
   - `Bug track`
     - 何时执行节点：当 intent 为“bug”时始终执行
     - 重试策略：是的，这对于不丢失错误报告至关重要。
     - 返回值：响应中包含的工单 ID
4. `User Input Steps`
   - `Human review`
     - 决策依据：原始邮件、回复草稿、紧急程度、分类
     - 预期输入格式：批准布尔值，以及可选的编辑回复
     - 触发条件：高度紧急、问题复杂或存在质量问题

## 2.4 设计`State`

这里给出一个数据是否要存储到state的依据。

- 包含在州内

  是否需要跨步骤保持？如果需要，则将其存储于State中。

- 不要储存

  能否从其他数据中推导出来？如果可以，则在需要时计算，不必将其存储在State中。

> 一个关键原则：State应存储原始数据，而不是格式化的文本。需要时，可在节点内部添加格式化的提示。

对于我们的需求，需要保存到State的信息有：

- 原始邮件和发件人信息（之后无法恢复）
- 分类结果（多个后续/下游节点需要）
- 搜索结果和客户数据（重新获取成本高昂）
- 答复草稿（需要保留到审查阶段）
- 执行元数据（用于调试和恢复）

## 2.5 错误处理

不同错误需要采用不同的处理策略：

| 错误类型                               | 谁来处理             | 处理策略                          | 适用场景                     |
| -------------------------------------- | -------------------- | --------------------------------- | ---------------------------- |
| 暂时性错误（网络问题、限流）           | 系统自动处理         | 重试策略                          | 通常重试即可解决的临时故障   |
| LLM 可修复的错误（工具失败、解析问题） | LLM                  | 将错误存入状态，再次交给 LLM 处理 | LLM 能根据错误调整执行方式   |
| 用户可解决的错误（信息缺失、指令不清） | 用户                 | 使用 `interrupt()` 暂停           | 需要用户补充信息才能继续     |
| 重试耗尽后仍可恢复的故障               | 开发者（声明式配置） | `error_handler`                   | 重试耗尽后执行补偿或恢复分支 |
| 意外错误                               | 开发者               | 让错误向上抛出                    | 需要调试的未知问题           |

1. 暂时性错误

   添加重试策略，自动重试网络问题和速率限制问题。

   重试次数用尽后，运行恢复功能，更新状态并路由到补偿分支。

   ```ts
   workflow.addNode(
     "searchDocumentation",
     searchDocumentation,
     {retryPolicy: { maxAttempts: 3, initialInterval: 1.0 }},
   );
   ```

2. LLM可修复的错误

   将错误存储在State中并返回，以便 LLM 可以查看哪里出了问题并重试：

   ```ts
   const executeTool: GraphNode<typeof State> = async (state, config) => {
     try {
       const result = await runTool(state.toolCall);
       return new Command({
         update: { toolResult: result },
         goto: "agent",
       });
     } catch (error) {
       // Let the LLM see what went wrong and try again
       return new Command({
         update: { toolResult: `Tool error: ${error}` },
         goto: "agent"
       });
     }
   }
   ```

3. 用户可修复错误

   必要时暂停并从用户处收集信息（例如帐户 ID、订单号或说明信息）：

   ```ts
   const lookupCustomerHistory: GraphNode<typeof State> = async (state, config) => {
     if (!state.customerId) {
       const userInput = interrupt({
         message: "Customer ID needed",
         request: "Please provide the customer's account ID to look up their subscription history",
       });
       return new Command({
         update: { customerId: userInput.customerId },
         goto: "lookupCustomerHistory",
       });
     }
     // Now proceed with the lookup
     const customerData = await fetchCustomerHistory(state.customerId);
     return new Command({
       update: { customerHistory: customerData },
       goto: "draftResponse",
     });
   }

4. 意外

   throw出来以便调试。不要处理你无法解决的问题：

   ```ts
   const sendReply: GraphNode<typeof EmailAgentState> = async (state, config) => {
     try {
       await emailService.send(state.responseText);
     } catch (error) {
       throw error;  // Surface unexpected errors
     }
   }
   ```

## 2.6 总结

构建这个邮件智能体，让我们了解了 LangGraph 的思维方式：

1. **拆分为独立步骤**

   每个节点专注做好一件事。这样的拆分支持流式进度更新、可暂停和恢复的持久化执行，也让调试更清晰，因为你可以检查各步骤之间的状态。

2. **状态是共享内存**

   存储原始数据，而不是格式化后的文本。这样，不同节点就能以不同方式使用同一份信息。

3. **节点就是函数**

   节点接收状态、执行任务并返回更新。需要决定执行路径时，节点会同时指定状态更新和下一个目标节点。

4. **错误是流程的一部分**

   暂时性故障通过重试处理；LLM 可修复的错误携带上下文返回模型；用户可解决的问题暂停并等待输入；意外错误则向上抛出，以便调试。

5. **人工输入是一等公民**

   `interrupt()` 函数可以无限期暂停执行、保存所有状态，并在你提供输入后从暂停处恢复。当它与其他操作放在同一个节点中时，必须放在最前面`(从interrupt()恢复时，interrupt函数之前的代码会重新执行一遍)`
## 2.7 进阶考虑

先给出答案: 节点拆小，出错后需要重做的工作更少，也更容易观察和调试.

   - **恢复**：失败后从节点开头重新执行。大节点包含的操作越多，重复工作越多。
   - **隔离**：外部 API、LLM 调用、数据库操作可以拆开，分别设置重试策略。
   - **观察**：独立节点方便检查分类结果等中间状态，理解路由原因。
   - **复用**：小节点更容易独立测试和复用。
   - **合并**：可以合并“读取邮件”和“意图分类”，但失败时两步都要重做。

详细内容:

为什么不把“读取邮件”和“意图分类”合并？为什么要把“文档搜索”和“起草回复”分开？

这涉及故障恢复与可观测性的权衡。

**故障恢复**

LangGraph 在节点边界创建检查点。中断或故障后恢复时，会从停止所在节点的开头重新执行。

节点越小，检查点越频繁，出错后重复的工作越少。多个操作合并成大节点后，即使在末尾失败，也要从节点开头全部重做。

**为什么采用这样的拆分方式**

- **隔离外部服务**：“文档搜索”和“缺陷跟踪”调用外部 API，独立成节点可将服务缓慢或失败的影响与 LLM 调用隔离，并单独配置重试策略。
- **观察中间结果**：将“意图分类”独立成节点，方便在行动前检查 LLM 的判断，了解何时、为何转向人工审核，便于调试和监控。
- **不同的故障类型**：LLM 调用、数据库查询和邮件发送需要不同的重试策略，拆分后可分别配置。
- **复用与测试**：小节点更容易独立测试，也更容易复用。

**另一种可行方式**

可以合并“读取邮件”和“意图分类”，但会失去在分类前检查原始邮件的机会，且节点失败时两步都要重做。

对大多数应用，独立节点带来的可观测性和调试收益值得这样的取舍。

**性能方面的考虑**

节点更多不一定更慢。LangGraph 默认采用 `async` 持久化模式，在后台写入检查点，执行无须等待，因此能以较小的性能影响频繁保存检查点。

也可按需调整：`"exit"` 模式仅在执行结束时保存；`"sync"` 模式则等待每个检查点写入完成后再继续。

| 值                | 行为                                         |
| ----------------- | -------------------------------------------- |
| `"async"`（默认） | 后台保存，同时继续执行                       |
| `"sync"`          | 保存完成后再执行下一步                       |
| `"exit"`          | 执行退出时保存，包括正常结束、报错或人工中断 |
