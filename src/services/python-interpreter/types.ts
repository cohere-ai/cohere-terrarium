export interface CodeExecutionResponse {
    success: boolean;
    final_expression?: any;
    output_files?: any[];
    error?: {
        type: string;
        message: string;
    };
    std_out?: string;
    std_err?: string;
    code_runtime?: number;
}

export interface FileData {
    filename: string;
    data: Buffer;
}

export interface PythonEnvironment {
    init(): Promise<void>;
    waitForReady(): Promise<void>;
    runCode(code: string, files: any[], sessionId?: string): Promise<CodeExecutionResponse>;
    cleanup(sessionId?: string): Promise<void>;
    terminate(sessionId?: string): Promise<void>;
}