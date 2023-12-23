declare module 'errno' {
    interface ErrorInfo {
        errno: string;
        code: number;
        description: string;
    }
    export const errno: ErrorInfo[];
}