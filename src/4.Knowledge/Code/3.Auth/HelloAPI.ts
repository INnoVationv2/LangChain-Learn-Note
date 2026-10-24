import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();

// learning 是 Keycloak 中的 Realm 名称，需要提前创建。
const issuer = "http://localhost:8080/realms/learning";

// 此 API 的标识，令牌的 aud 必须包含它。
const audience = "hello-api";

// 获取并缓存 Keycloak 公钥，用于验证令牌签名。
const jwks = createRemoteJWKSet(
    new URL(`${issuer}/protocol/openid-connect/certs`)
);

// 对所有 /hello 请求进行令牌验证。
app.use("/hello", async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];

    if (!token) {
        res.setHeader("WWW-Authenticate", "Bearer");
        res.status(401).json({ message: "请提供 Access Token" });
        return;
    }

    try {
        const { payload } = await jwtVerify(token, jwks, {
            issuer,                     // 必须由指定 Realm 签发
            audience,                   // 必须允许用于当前 API
            algorithms: ["RS256"],      // Keycloak 默认签名算法
            requiredClaims: ["exp"],    // 要求包含有效期，并自动检查过期
        });

        // Keycloak 默认 Access Token 的载荷 typ 为 Bearer。
        if (payload.typ !== "Bearer") {
            throw new Error("不是 Access Token");
        }
    } catch {
        res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
        res.status(401).json({ message: "令牌无效或验证失败" });
        return;
    }

    next(); // 验证成功，继续执行接口。
});

app.get("/hello", (_req, res) => {
    res.type("text/plain").send("Hello World");
});

app.listen(3000, "127.0.0.1", () => {
    console.log("API 地址：http://localhost:3000/hello");
});