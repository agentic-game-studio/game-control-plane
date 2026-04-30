export declare class GodotConnection {
    private wss;
    private client;
    private port;
    private fixedPort;
    private pendingRequests;
    private heartbeatTimer;
    constructor(port?: number, fixedPort?: boolean);
    /** Start WebSocket server on first available port in range */
    connect(): Promise<void>;
    disconnect(): void;
    isConnected(): boolean;
    getPort(): number;
    sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    private handleMessage;
    private rejectAllPending;
    private startHeartbeat;
    private stopHeartbeat;
}
//# sourceMappingURL=godot-connection.d.ts.map