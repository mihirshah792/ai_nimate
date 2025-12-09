export interface Response<T> {
    status: 'success' | 'failed';
    message: string;
    payload?: T;
}

export const getResponse = <T>(status: 'success' | 'failed', message: string, payload?: T): Response<T> => {
    return {
        status,
        message,
        payload,
    };
};