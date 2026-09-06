export type GameState = {
  playerX: number;
  score: number;
  sunAzimuth: number;
  sunElevation: number;
  /** Red channel of the atmosphere's sun transmittance; stays 0 when no atmosphere is built. */
  sunTransmittanceRed: number;
  networkActionAcks: number;
  networkConnected: boolean;
  networkError: string;
  networkLocalX?: number;
  networkLocalZ?: number;
  networkPeerId: string;
  networkPeerObserved: boolean;
  networkProtocolErrors: number;
  networkReconnects: number;
  networkRemoteDistance: number;
  networkRemoteX?: number;
  networkRemoteZ?: number;
  networkRetry: number;
  networkSessionId: string;
  networkStatus: "disabled" | "connecting" | "connected" | "disconnected";
  networkUnmatchedActionAcks: number;
};
