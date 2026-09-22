declare module 'react' {
  export type ReactNode = unknown;
  export interface ReactElement {}
  export const Fragment: unknown;
  export function createElement(type: string | ((props: Record<string, unknown>) => ReactNode), props?: Record<string, unknown> | null, ...children: ReactNode[]): ReactElement;
}
declare module 'react-dom/client' {
  interface Root { render(node: unknown): void; unmount(): void }
  export function createRoot(container: Element | DocumentFragment): Root;
}
declare module 'react-dom/server' {
  export function renderToStaticMarkup(node: unknown): string;
}
