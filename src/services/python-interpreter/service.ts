import { PyodideInterface, loadPyodide } from "pyodide";
import { waitFor } from "../../utils/async-utils";
import { promises as fs } from 'fs';
import * as path from 'path';
import { CodeExecutionResponse, FileData, PythonEnvironment } from "./types";


const pythonEnvironmentHomeDir = "/home/earth";
const defaultDirectoryOuterPath = 'default_python_home';

interface SessionEnvironment {
    pyodide: PyodideInterface;
    interruptBuffer: SharedArrayBuffer;
    interrupt: Uint8Array;
    out_string: string;
    err_string: string;
    createdAt: number; // timestamp to track session age
}

export class PyodidePythonEnvironment implements PythonEnvironment {
    default_files: any[] = []
    default_file_names = new Set()

    // For backward compatibility (stateless execution)
    private defaultPyodideEnv?: SessionEnvironment;

    // For session-based execution
    private sessionEnvironments: Map<string, SessionEnvironment> = new Map();

    // Maximum session age - clean up sessions older than this (in milliseconds)
    private readonly MAX_SESSION_AGE = 30 * 60 * 1000; // 30 minutes

    async prepareEnvironment() {
        console.log("Preparing Pyodide environment");
        const files = await fs.readdir(defaultDirectoryOuterPath);
        const filePromises = files.map(file => {
            const filePath = path.join(defaultDirectoryOuterPath, file);
            return this.readHostFileAsync(filePath);
        });
        const filesData = await Promise.all(filePromises);
        filesData.forEach(({ filename, data }) => {
            this.default_files.push({ "filename": filename, "byte_data": new Uint8Array(data) })
            this.default_file_names.add(filename)
        });
    }

    private createPyodideEnvironment(basePath: string = pythonEnvironmentHomeDir): Promise<SessionEnvironment> {
        return new Promise(async (resolve, reject) => {
            try {
                console.log(`Creating Pyodide environment for path: ${basePath}`);

                const interruptBuffer = new SharedArrayBuffer(4);
                const interrupt = new Uint8Array(interruptBuffer);

                const pyodide: PyodideInterface = await loadPyodide({
                    packageCacheDir: "pyodide_cache", // allows us to cache the packages in the cloud function deployment
                    stdout: msg => { /* intentionally left empty for sessions */ },
                    stderr: msg => { /* intentionally left empty for sessions */ },
                    jsglobals: {
                        clearInterval, clearTimeout, setInterval, setTimeout,
                        // the following need some explanation:
                        // we need to provide a fake ImageData & document object to pyodide, because matplotlib-pyodide polyfills try to access them when initializing
                        // BUT luckily for us matplotlib-pyodide does not actually use them for .savefig rendering (only for .show()), so we can just provide empty objects
                        ImageData: {}, document: {
                            getElementById: (id: any) => {
                                if (id.includes("canvas")) return null; // lol don't ask ... this is needed! https://github.com/pyodide/matplotlib-pyodide/blob/61935f72718c0754a9b94e1569a685ad3c50ae91/matplotlib_pyodide/wasm_backend.py#L48
                                else return {
                                    addEventListener: () => { },
                                    style: {},
                                    classList: { add: () => { }, remove: () => { } },
                                    setAttribute: () => { },
                                    appendChild: () => { },
                                    remove: () => { },
                                }
                            },
                            createElement: () => ({
                                addEventListener: () => { },
                                style: {},
                                classList: { add: () => { }, remove: () => { } },
                                setAttribute: () => { },
                                appendChild: () => { },
                                remove: () => { },
                            }),
                            createTextNode: () => ({
                                addEventListener: () => { },
                                style: {},
                                classList: { add: () => { }, remove: () => { } },
                                setAttribute: () => { },
                                appendChild: () => { },
                                remove: () => { },
                            }),
                            body: {
                                appendChild: () => { },
                            },
                        }
                    }, // removing any way for python to access any of the hosts js functions or variables
                    env: { "HOME": basePath } // using a non-descriptive home dir
                });

                // write the default files from default_python_home to the pyodide file system
                this.default_files.forEach((f) => {
                    pyodide.FS.writeFile(pyodide.PATH.join2(basePath, f.filename), f.byte_data);
                })

                // load the packages we commonly use to avoid the latency hit during the user req
                await pyodide.loadPackage(["numpy", "matplotlib", "pandas"]);

                // set interrupt buffer to allow for termination
                pyodide.setInterruptBuffer(interrupt);

                // second part of the import (also takes a latency hit), its ok to re-import packages
                await pyodide.runPythonAsync("import matplotlib.pyplot as plt\nimport pandas as pd\nimport numpy as np");

                const sessionEnv: SessionEnvironment = {
                    pyodide,
                    interruptBuffer,
                    interrupt,
                    out_string: "",
                    err_string: "",
                    createdAt: Date.now(),
                };

                console.log(`Pyodide is loaded for path: ${basePath}`);

                resolve(sessionEnv);
            } catch (error) {
                console.error('Error creating Pyodide environment:', error);
                reject(error);
            }
        });
    }

    async loadEnvironment(): Promise<void> {
        console.log("Loading default Pyodide environment");
        const defaultEnv = await this.createPyodideEnvironment();

        // Now add the default output handlers to the default environment for backward compatibility
        // We keep these as instance variables for backward compatibility
        this.defaultPyodideEnv = defaultEnv;
        this.defaultPyodideEnv.pyodide.setStdout({ batched: (msg) => { this.defaultPyodideEnv!.out_string += msg + "\n"; } });
        this.defaultPyodideEnv.pyodide.setStderr({ batched: (msg) => { this.defaultPyodideEnv!.err_string += msg + "\n"; } });
    }

    async init(): Promise<void> {
        await this.prepareEnvironment();
        await this.loadEnvironment();
    }

    async waitForReady(): Promise<void> {
        // For backward compatibility (stateless execution)
        if (!this.defaultPyodideEnv) {
            let max_tries = 0
            while (max_tries < 100 && this.defaultPyodideEnv == null) {
                await waitFor(100);
                max_tries++;
            }
        }

        if (this.defaultPyodideEnv == null) {
            console.error("pyodide is still not loaded after waiting")
            return Promise.reject("pyodide is still not loaded after waiting")
        }

        return Promise.resolve();
    }

    async terminate(sessionId?: string): Promise<void> {
        if (sessionId) {
            // For a specific session
            const sessionEnv = this.sessionEnvironments.get(sessionId);
            if (sessionEnv) {
                sessionEnv.interrupt[0] = 1;
                // Clear interrupt buffer after termination
                sessionEnv.interrupt[0] = 0;
            }
        } else {
            // For backward compatibility (default environment)
            if (this.defaultPyodideEnv) {
                this.defaultPyodideEnv.interrupt[0] = 1;
                // Clear interrupt buffer after termination
                this.defaultPyodideEnv.interrupt[0] = 0;
            }
        }
    }

    async cleanup(sessionId?: string): Promise<void> {
        if (sessionId) {
            // Clean up a specific session
            const sessionEnv = this.sessionEnvironments.get(sessionId);
            if (sessionEnv) {
                sessionEnv.interrupt[0] = 1;
                this.sessionEnvironments.delete(sessionId);
            }
        } else {
            // For backward compatibility (default environment)
            await this.loadEnvironment();
        }
    }


    /**
     * Simple helper function to read a file asynchronously.
     * @param {string} filePath - The path of the file to be read.
     * @returns {Promise<{ filename: string, data: Buffer }>} - A promise that resolves to an object containing the filename and the file data.
     * @throws {Error} - If there is an error reading the file.
     */
    async readHostFileAsync(filePath: any): Promise<FileData> {
        const buffer = await fs.readFile(filePath);
        return { filename: path.basename(filePath), data: buffer };
    }


    /**
     * Function to recursively list files in the pyodide file system from the given directory.
     * @param {SessionEnvironment} sessionEnv - The environment whose file system to list
     * @param {string} dir - The directory to list
     * @returns list of file paths
     */
    private listFilesRecursive(sessionEnv: SessionEnvironment, dir: string): string[] {
        const pyodide = sessionEnv.pyodide;
        var files: any[] = [];
        var entries = pyodide.FS.readdir(dir);

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry === '.' || entry === '..') {
                // Skip entries that are themselves directories
                continue;
            }
            if (this.default_file_names.has(entry)) {
                // Skip default files
                continue;
            }
            var fullPath = pyodide.PATH.join2(dir, entry);

            if (pyodide.FS.isDir(pyodide.FS.stat(fullPath).mode)) {
                // If it's a directory, recursively list files in that directory
                files = files.concat(this.listFilesRecursive(sessionEnv, fullPath));
            } else {
                // If it's a file, add it to the list
                files.push(fullPath);
            }
        }

        return files;
    }

    /**
     * Reads a file from the pyodide file system from the given file path and returns its content as a base64 encoded string.
     * @param {SessionEnvironment} sessionEnv - The environment whose file system to read from
     * @param {string} filePath - The path of the file to be read.
     * @returns {string} - The base64 encoded content of the file.
     */
    private readFileAsBase64(sessionEnv: SessionEnvironment, filePath: string): string {
        const pyodide = sessionEnv.pyodide;
        var fileData = pyodide.FS.readFile(filePath, { encoding: 'binary' });
        return this.bytesToBase64(fileData);
    }

    /**
     * Transforms a byte array into a base64 encoded string.
     * @param {Uint8Array} bytes the raw bytes to encode as base64
     * @returns base64 encoded string
     */
    private bytesToBase64(bytes: any): string {
        const binString = String.fromCodePoint(...bytes);
        return btoa(binString);
    }

    /**
     * transforms a base64 encoded string into a byte array.
     * @param {string} base64
     * @returns Uint8Array of bytes
     */
    private base64ToBytes(base64: any): Uint8Array {
        const binString = atob(base64);
        return (Uint8Array as any).from(binString, (m: any) => m.codePointAt(0));
    }

    /**
     * Ensure all active sessions are still valid by removing expired ones
     */
    private async cleanExpiredSessions(): Promise<void> {
        const now = Date.now();
        for (const [sessionId, sessionEnv] of this.sessionEnvironments.entries()) {
            if (now - sessionEnv.createdAt > this.MAX_SESSION_AGE) {
                console.log(`Cleaning up expired session: ${sessionId}`);
                await this.cleanup(sessionId);
            }
        }
    }

    /**
     * Get the session environment for the given session ID, creating it if it doesn't exist
     */
    private async getSessionEnvironment(sessionId: string): Promise<SessionEnvironment> {
        let sessionEnv = this.sessionEnvironments.get(sessionId);

        if (!sessionEnv) {
            console.log(`Creating new session environment: ${sessionId}`);
            sessionEnv = await this.createPyodideEnvironment(`${pythonEnvironmentHomeDir}_${sessionId}`);

            // Set custom output handlers for this session
            sessionEnv.pyodide.setStdout({ batched: (msg) => { sessionEnv!.out_string += msg + "\n"; } });
            sessionEnv.pyodide.setStderr({ batched: (msg) => { sessionEnv!.err_string += msg + "\n"; } });

            this.sessionEnvironments.set(sessionId, sessionEnv);
        }

        return sessionEnv;
    }

    async runCode(code: string, files: any[], sessionId?: string): Promise<CodeExecutionResponse> {
        const startCode = Date.now();

        // Clean up expired sessions periodically
        await this.cleanExpiredSessions();

        let sessionEnv: SessionEnvironment;

        if (sessionId) {
            // Stateful execution: use session-specific environment
            sessionEnv = await this.getSessionEnvironment(sessionId);
        } else {
            // Backward compatibility: use default stateless environment
            if (!this.defaultPyodideEnv) {
                throw new Error("Default environment not initialized");
            }
            sessionEnv = this.defaultPyodideEnv;
        }

        // Clear the output strings for this run
        sessionEnv.out_string = "";
        sessionEnv.err_string = "";

        let result: CodeExecutionResponse = { success: true };

        try {
            const pyodide = sessionEnv.pyodide;

            // load available and needed packages - only supports pyodide built-in packages
            await pyodide.loadPackagesFromImports(code)

            //
            // write the input files to the pyodide file system
            //
            files.forEach((f) => {
                if (f.filename == undefined || f.b64_data == undefined) {
                    result.success = false;
                    result.error = { type: "parsing", message: "file data is missing for: " + JSON.stringify(f) }
                    return result;
                }
                // Determine the base path depending on whether this is a session or stateless
                const basePath = sessionId ? `${pythonEnvironmentHomeDir}_${sessionId}` : pythonEnvironmentHomeDir;
                pyodide.FS.writeFile(pyodide.PATH.join2(basePath, f.filename), this.base64ToBytes(f.b64_data));
            });


            //
            // !! here is where the code is actually executed !!
            //
            let interpreterResult = await pyodide.runPythonAsync(code);
            //
            // soak up newly created files and return them as output
            //
            const basePath = sessionId ? `${pythonEnvironmentHomeDir}_${sessionId}` : pythonEnvironmentHomeDir;
            var allFiles = this.listFilesRecursive(sessionEnv, basePath);

            // get only the new files (not in the input files) and read as base64
            let input_file_names = files.map(f => f.filename)
            let new_files = allFiles
                .filter(f => !input_file_names.includes(f.slice(basePath.length + 1)))
                .map(f => {
                    return { "filename": f.slice(basePath.length + 1), "b64_data": this.readFileAsBase64(sessionEnv, f) };
                });

            console.log("output files:", new_files.map(f => f.filename + " " + f.b64_data.slice(0, 10) + "... " + f.b64_data.length));
            result.output_files = new_files

            let result_reporting = ""
            if (interpreterResult != undefined) {
                result_reporting = interpreterResult.toString().replace(/\n/g, '\\n');
            }

            console.log("[Success] Code:", (code as any).replace(/\n/g, '\\n'),
                "final_expression:", result_reporting,
                "stdout:", sessionEnv.out_string.replace(/\n/g, '\\n'),
                "stderr:", sessionEnv.err_string.replace(/\n/g, '\\n'));


            result.final_expression = interpreterResult;
            result.success = true
        }
        catch (error: any) {
            // enrich error message with more code context
            let errorMsg = error.toString()
            // check for File "<exec>", line N, in <module> and extract the line number
            let lineMatch = errorMsg.match(/File "<exec>", line (\d+)/)
            console.log("lineMatch", lineMatch)
            if (lineMatch != null) {
                let lineNum = parseInt(lineMatch[1])
                let codeLines = code.split("\n")
                let startLine = Math.max(1, lineNum - 4)
                let endLine = Math.min(codeLines.length, lineNum + 4)
                let codeContext = codeLines.slice(startLine - 1, endLine)
                    .map((line, idx) => { return (startLine + idx) + ": " + line })
                    .join("\n")
                errorMsg = errorMsg + "\n\nCode context:\n" + codeContext
            }

            console.error("[Failure] Code:", code.replace(/\n/g, '\\n'),
                "Error:", errorMsg.replace(/\n/g, '\\n'));

            result.error = { "type": error.type, "message": errorMsg };
            result.success = false
        }

        result.std_out = sessionEnv.out_string;
        result.std_err = sessionEnv.err_string;
        result.code_runtime = (Date.now() - startCode)

        // For backward compatibility (stateless execution), clean up the environment after execution
        if (!sessionId) {
            // Reset the output strings for the default environment
            sessionEnv.out_string = "";
            sessionEnv.err_string = "";

            // Note: We're not recycling the default environment here for performance
            // If needed for security, we could call cleanup() on the default environment
        }

        return result;
    }
}