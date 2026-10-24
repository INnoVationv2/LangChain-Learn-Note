import express from "express";
import session from "express-session";
import { createHash, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const app = express();
const issuer = "http://localhost:8080/realms/learning";
const clientId = "hello-web";
const redirectUri = "http://localhost:3001/callback";
const apiUrl = "http://localhost:3000/hello";

declare module "express-session" {
    interface SessionData {
        oauth?: { state: string; verifier: string };
        accessToken?: string;
    }
}

// 用会话保存 Token，浏览器只保存会话 Cookie。
app.use(session({
    name: "hello-web.sid",
    secret: randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
}));
app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

// ① 访问页面：没有 Token 就去登录，有 Token 就调用 API。
app.get(["/", "/hello"], async (req, res) => {
    if (!req.session.accessToken) {
        res.redirect("/login");
        return;
    }
    const response = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${req.session.accessToken}` },
    });
    res.status(response.status).type("text").send(await response.text());
});

// ② 跳转登录：保存 state 和 PKCE 原始值，把校验参数交给 Keycloak。
app.get("/login", (req, res) => {
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    req.session.oauth = { state, verifier };

    const url = new URL(`${issuer}/protocol/openid-connect/auth`);
    url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
    }).toString();
    res.redirect(url.toString());
});

// ③ 登录回调：检查 state，用授权码和 PKCE 原始值换取 Token。
app.get("/callback", async (req, res) => {
    const oauth = req.session.oauth;
    if (!oauth || req.query.state !== oauth.state || typeof req.query.code !== "string") {
        res.status(400).send("登录回调无效");
        return;
    }
    delete req.session.oauth;

    const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
        method: "POST",
        body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            redirect_uri: redirectUri,
            code: req.query.code,
            code_verifier: oauth.verifier,
        }),
    });
    if (!response.ok) {
        res.status(502).send("换取 Token 失败");
        return;
    }
    const { access_token } = await response.json();

    // 登录成功后更换会话 ID，避免继续使用登录前的会话。
    await promisify(req.session.regenerate.bind(req.session))();
    req.session.accessToken = access_token;
    res.redirect("/hello");
});

app.listen(3001, "127.0.0.1", () => console.log("打开 http://localhost:3001/hello"));
