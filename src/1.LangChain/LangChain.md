

# 二.Middleware

Middleware的作用
- 通过日志记录, 分析和调试来跟踪Agent行为
- 修改Prompt, tool list, output format
- 添加重试、回退和提前终止逻辑
- 应用速率限制、防护措施和个人身份信息检测。

Middleware的执行步骤
<img src="http://pic-save-fury.oss-cn-shanghai.aliyuncs.com/uPic/middleware_final.png" alt="Middleware flow diagram" style="zoom:50%;" />

## 1. pre-built Middleware
LangChain和Deep Agents提供了一些常见的中间件。

https://docs.langchain.com/oss/javascript/langchain/middleware/built-in

## 2.MiddleWare最佳实践
1. 保持职责单一：每个中间件专注做好一件事。
2. 妥善处理错误：避免中间件错误导致 Agent 崩溃。
3. **选择合适的钩子类型**：
    - 节点式（Node-style）：用于顺序执行的逻辑，如日志记录、校验。
    - 包装式（Wrap-style）：用于控制调用流程，如重试、降级、缓存。
4. 清楚说明自定义状态字段的含义。
5. 集成前，先独立对中间件进行单元测试。
6. 注意执行顺序：将关键中间件放在列表前面。
7. 尽量使用内置中间件。

# 三.高级用法

## 3.1 上下文工程
Agent有三类数据源:

| 数据来源    | 别称     | 作用范围 | 示例                                          |
| :---------- | :------- | :------- | :-------------------------------------------- |
| **Context** | 静态配置 | 对话范围 | 用户 ID、API 密钥、数据库连接、权限、环境设置 |
| **State**   | 短期记忆 | 对话范围 | 当前消息、已上传文件、身份验证状态、工具结果  |
| **Store**   | 长期记忆 | 交叉对话 | 用户偏好、提取的消息、记忆、历史数据          |

### 模型上下文

模型每次调用时，以下内容决定最终结果。

| 内容            | 作用                     |
| --------------- | ------------------------ |
| System Prompt   | 向LLM提供的基本指令      |
| Message         | 发送给大模型完成消息列表 |
| Tool            | Agent可使用的程序        |
| Model           | 实际调用的Model型号      |
| Response Format | 模型最终响应的Schema     |
