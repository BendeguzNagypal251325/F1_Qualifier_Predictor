// Links the cameras of several 3D viewers (compare page). Kept free of three.js so pages can create
// one without loading the 3D code. Whoever the user moves last leads; the other viewers copy its
// view direction and distance around their own target.
export interface CameraSync {
  leader: number | null;
  offset: [number, number, number];
  next: number;
}

export const makeCameraSync = (): CameraSync => ({ leader: null, offset: [0, 0, 0], next: 0 });
