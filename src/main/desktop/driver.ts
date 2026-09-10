import type {
  Action,
  ActionResult,
  Rect,
  Screenshot,
  UiElementInfo,
  VerificationResult,
  VerificationSpec,
  WindowInfo
} from '../computer/index.js';

export interface DesktopCapabilities {
  available: boolean;
  capture: boolean;
  pointer: boolean;
  keyboard: boolean;
  clipboardRead: boolean;
  clipboardWrite: boolean;
  windows: boolean;
  uiElements: boolean;
  focus: boolean;
  reason?: string;
}

export type DesktopObserveRequest =
  | { kind: 'active' }
  | { kind: 'windows' }
  | { kind: 'ui'; window?: number; query?: string; role?: string; maxResults?: number }
  | {
      kind: 'state';
      window?: number;
      maxWidth?: number;
      maxElements?: number;
      includeScreenshot?: boolean;
      includeUi?: boolean;
    }
  | { kind: 'wait-window'; title?: string; process?: string; foreground?: boolean; timeoutMs?: number }
  | { kind: 'screenshot'; window?: number; full?: boolean; maxWidth?: number; crop?: Rect };

export type DesktopObserveResult =
  | ({ kind: 'active' } & { window: WindowInfo | null; screen: Rect })
  | ({ kind: 'windows' } & { windows: WindowInfo[]; screen: Rect })
  | ({ kind: 'ui' } & { window: number; snapshotId: number; elements: UiElementInfo[] })
  | ({ kind: 'state' } & {
      window: WindowInfo;
      snapshotId: number | null;
      screenshot: Screenshot | null;
      elements: UiElementInfo[];
    })
  | ({ kind: 'wait-window' } & { window: WindowInfo })
  | ({ kind: 'screenshot' } & { screenshot: Screenshot });

export type DesktopObserveResultFor<Request extends DesktopObserveRequest> = Extract<
  DesktopObserveResult,
  { kind: Request['kind'] }
>;

export interface DesktopActionRequest {
  actions: Action[];
  frameId?: number;
  capture?: {
    window?: number;
    full?: boolean;
    maxWidth?: number;
    crop?: Rect;
    preferActiveWindow?: boolean;
  };
  verify?: VerificationSpec;
}

export type DesktopActionOutcome = ActionResult & {
  screenshot: Screenshot | null;
  verification: VerificationResult | null;
};

/**
 * Deep seam used by model-facing Desktop tools. Callers know only three operations plus
 * disposal; platform-specific capture/input/UIA/portal machinery remains inside adapters.
 */
export interface DesktopDriver {
  capabilities(): Promise<DesktopCapabilities>;
  observe<Request extends DesktopObserveRequest>(request: Request): Promise<DesktopObserveResultFor<Request>>;
  act(request: DesktopActionRequest): Promise<DesktopActionOutcome>;
  dispose(): Promise<void>;
}
