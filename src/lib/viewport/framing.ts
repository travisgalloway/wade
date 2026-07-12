// Pure math: given an object's bounds and a camera's field of view, compute the camera
// position/target that centers and frames it. No renderer, no DOM, no Threlte — this is what
// keeps it unit-testable in the plain node Vitest project.
import { Box3, Sphere, Vector3 } from 'three';

export interface FramingInput {
	/** World-space bounds of the object to frame. */
	box: Box3;
	/** Vertical field of view, in degrees (`PerspectiveCamera.fov`). */
	fovDegrees: number;
	/** Viewport aspect ratio, width / height (`PerspectiveCamera.aspect`). */
	aspect: number;
	/** Normalized-or-not direction from the target to the camera. Defaults to a gentle 3/4 angle. */
	direction?: Vector3;
	/** Multiplier applied to the fitting distance for breathing room around the object. */
	padding?: number;
}

export interface FramingResult {
	position: Vector3;
	target: Vector3;
}

const DEFAULT_DIRECTION = new Vector3(1, 0.6, 1);
const DEFAULT_PADDING = 1.2;

/**
 * Centers the camera's target on the box and pushes the camera back along `direction` far
 * enough that the box's bounding sphere fits inside whichever of the camera's vertical/horizontal
 * field of view is tighter — so the object fits regardless of viewport aspect ratio.
 */
export function frameBox(input: FramingInput): FramingResult {
	const {
		box,
		fovDegrees,
		aspect,
		direction = DEFAULT_DIRECTION,
		padding = DEFAULT_PADDING
	} = input;

	const target = box.getCenter(new Vector3());
	const sphere = box.getBoundingSphere(new Sphere());
	const radius = Math.max(sphere.radius, 1e-6);

	const verticalFovRad = (fovDegrees * Math.PI) / 180;
	const horizontalFovRad = 2 * Math.atan(Math.tan(verticalFovRad / 2) * aspect);
	const limitingFovRad = Math.min(verticalFovRad, horizontalFovRad);

	const distance = (radius / Math.sin(limitingFovRad / 2)) * padding;

	const position = target.clone().addScaledVector(direction.clone().normalize(), distance);

	return { position, target };
}
