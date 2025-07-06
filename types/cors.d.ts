declare module 'cors' {
  interface CorsOptions {
    origin?: string | string[];
    credentials?: boolean;
    [key: string]: any;
  }
  function cors(options?: CorsOptions): any;
  export default cors;
}
