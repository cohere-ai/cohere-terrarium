import express, { Express, Request, Response } from "express";
import { PyodideSessionManager } from "../src/services/python-interpreter/session";

const terrariumApp: Express = express();
terrariumApp.use(express.json({ limit: "100mb" }));

const sessionManager = PyodideSessionManager.getInstance();

terrariumApp.post("/sessions", (req, res) => {
    const session = sessionManager.createSession();
    res.send({ session_id: session.id });
});

async function runRequest(req: any, res: any): Promise<void> {
    res.setHeader("Content-Type", "application/json");

    const sessionId = req.body.session_id;
    if (!sessionId) {
        res.status(400).send({
            success: false,
            error: { type: "bad_request", message: "session_id is required" },
        });
        return;
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
        res.status(404).send({
            success: false,
            error: { type: "not_found", message: "session not found" },
        });
        return;
    }

    await session.pythonEnvironment.waitForReady();

    const code = req.body.code;
    if (code == undefined || code.trim() == "") {
        res.send(
            JSON.stringify({
                success: false,
                error: { type: "parsing", message: "no code provided" },
            }) + "\n",
        );
        return;
    }
    let files: any[] = [];
    if (req.body.files != undefined) {
        files = req.body.files;
        console.log("Got " + files.length + " input files");
        console.log(
            files.map(
                (f) =>
                    f.filename +
                    " " +
                    f.b64_data.slice(0, 10) +
                    "... " +
                    f.b64_data.length,
            ),
        );
    }

    const result = await session.pythonEnvironment.runCode(code, files);

    res.write(JSON.stringify(result) + "\n");
    res.end();
}

terrariumApp.post("/", async (req, res) => {
    await runRequest(req, res);
});

terrariumApp.get("/health", (req, res) => {
    res.send("hi!");
});

const _server = terrariumApp.listen(8080, () => {
    console.log("Server is running on port 8080");
});
