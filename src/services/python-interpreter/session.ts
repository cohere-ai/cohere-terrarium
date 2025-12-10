import { v4 as uuidv4 } from "uuid";
import { PyodidePythonEnvironment } from "./service";
import { PythonEnvironment } from "./types";

const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

export class PyodideSession {
    public id: string;
    public pythonEnvironment: PythonEnvironment;
    private timeoutId: NodeJS.Timeout;

    constructor() {
        this.id = uuidv4();
        this.pythonEnvironment = new PyodidePythonEnvironment();
        this.pythonEnvironment.init();
        this.timeoutId = this.resetTimeout();
    }

    private resetTimeout(): NodeJS.Timeout {
        clearTimeout(this.timeoutId);
        console.log(
            `Session ${this.id}: Timeout reset for ${SESSION_TIMEOUT}ms`,
        );
        return setTimeout(async () => {
            console.log(
                `Session ${this.id}: Timeout triggered, destroying session`,
            );
            await PyodideSessionManager.getInstance().destroySession(this.id);
        }, SESSION_TIMEOUT);
    }

    public keepAlive() {
        console.log(`Session ${this.id}: keepAlive called`);
        this.timeoutId = this.resetTimeout();
    }
}

export class PyodideSessionManager {
    private static instance: PyodideSessionManager;
    private sessions: Map<string, PyodideSession> = new Map();

    private constructor() {}

    public static getInstance(): PyodideSessionManager {
        if (!PyodideSessionManager.instance) {
            PyodideSessionManager.instance = new PyodideSessionManager();
        }
        return PyodideSessionManager.instance;
    }

    public createSession(): PyodideSession {
        const session = new PyodideSession();
        this.sessions.set(session.id, session);
        console.log(`Session ${session.id}: Created new session`);
        return session;
    }

    public getSession(id: string): PyodideSession | undefined {
        const session = this.sessions.get(id);
        if (session) {
            console.log(
                `Session ${id}: Retrieved existing session, calling keepAlive`,
            );
            session.keepAlive();
        } else {
            console.log(`Session ${id}: Session not found`);
        }
        return session;
    }

    public async destroySession(id: string): Promise<void> {
        const session = this.sessions.get(id);
        if (session) {
            console.log(`Session ${id}: Starting destruction process`);
            await session.pythonEnvironment.terminate();
            this.sessions.delete(id);
            console.log(
                `Session ${id}: Successfully destroyed and removed from sessions`,
            );
        } else {
            console.log(
                `Session ${id}: Attempted to destroy non-existent session`,
            );
        }
    }
}
