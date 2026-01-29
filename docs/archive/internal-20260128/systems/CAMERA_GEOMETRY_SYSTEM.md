# Camera Geometry System - Three Critical Angles

## Overview

Every image is defined by **three critical angles**:

1. **Sensor Plane Angle**: Angle from the sensor plane towards the subject
2. **Subject-to-Camera Angle**: Angle from subject's perspective looking at camera
3. **Lens Angle of View**: Field of view of the lens (FOV)

## The Three Angles Explained

### 1. Sensor Plane Angle
**Definition**: Angle between the sensor plane normal (where camera is pointing) and the vector to the subject.

**Calculation**: 
- Sensor normal vector from camera yaw/pitch
- Vector from camera to subject
- Angle = arccos(dot product / magnitudes)

**Example**: 
- Camera pointing at 45° yaw, 15° pitch
- Subject at position (5m, 3m, 0m)
- Sensor plane angle = angle between camera's pointing direction and line to subject

### 2. Subject-to-Camera Angle
**Definition**: Angle from the subject's forward direction to the camera position.

**Calculation**:
- Subject's forward vector (vehicle's forward direction)
- Vector from subject to camera
- Angle = arccos(dot product / magnitudes)

**Example**:
- Vehicle facing north (0°)
- Camera at 45° from vehicle front
- Subject-to-camera angle = 45°

### 3. Lens Angle of View (FOV)
**Definition**: Field of view of the lens in degrees.

**Calculation**: 
- FOV = 2 × arctan(sensor_size / (2 × effective_focal_length))
- Effective focal length = focal_length × crop_factor

**Example**:
- 50mm lens on full frame (sensor = 43.3mm diagonal)
- FOV = 2 × arctan(43.3 / (2 × 50)) = ~47°

## Coordinate System

### Camera Position (meters from vehicle center)
- **X**: Forward/backward (positive = forward)
- **Y**: Left/right (positive = driver side)
- **Z**: Up/down (positive = up)

### Camera Orientation
- **Yaw**: Rotation around Z axis (-180° to +180°)
- **Pitch**: Tilt up/down (-90° to +90°)

### Subject Position
- Default: Vehicle center at (0, 0, 0)
- Subject forward direction: Typically 0° (facing +X)

## Usage

### Record Angle with Full Geometry
```sql
SELECT record_angle_with_camera_geometry(
  'image-id',
  'vehicle-id',
  -60,  -- X coordinate (azimuth)
  -30,  -- Y coordinate (elevation)
  15,   -- Z coordinate (height)
  -- Camera position
  5.0,   -- camera_x_m (5m forward)
  -3.0,  -- camera_y_m (3m driver side)
  1.5,   -- camera_z_m (1.5m high)
  -- Camera orientation
  -60,   -- camera_yaw (pointing driver side)
  15,    -- camera_pitch (slightly up)
  -- Subject (vehicle center)
  0, 0, 0, 0,  -- subject position and orientation
  -- Lens
  50,    -- focal_length_mm
  43.3,  -- sensor_size_mm (full frame diagonal)
  1.0    -- crop_factor (full frame)
);
```

**Automatically calculates:**
- Sensor plane angle: ~25° (camera pointing direction vs subject)
- Subject-to-camera angle: ~45° (from vehicle front to camera)
- Lens angle of view: ~47° (50mm lens FOV)

## Query Examples

### Find images with similar camera geometry
```sql
SELECT * FROM angle_spectrum_full_view
WHERE sensor_plane_angle BETWEEN 20 AND 30
  AND subject_to_camera_angle BETWEEN 40 AND 50
  AND lens_angle_of_view BETWEEN 45 AND 50;
```

### Find wide-angle shots (high FOV)
```sql
SELECT * FROM angle_spectrum_full_view
WHERE lens_angle_of_view > 60;  -- Wide angle lens
```

### Find telephoto shots (low FOV)
```sql
SELECT * FROM angle_spectrum_full_view
WHERE lens_angle_of_view < 30;  -- Telephoto lens
```

### Find images with similar camera positioning
```sql
SELECT * FROM angle_spectrum_full_view
WHERE ABS(camera_position_x_m - 5.0) < 1.0
  AND ABS(camera_position_y_m - -3.0) < 1.0
  AND ABS(camera_position_z_m - 1.5) < 0.5;
```

## Integration with EXIF Data

The system can extract camera geometry from EXIF:
- Focal length → lens angle of view
- Camera make/model → crop factor
- Sensor dimensions → sensor size

```sql
SELECT * FROM extract_camera_geometry_from_exif(
  '{"FocalLength": "50", "Make": "Canon", "Model": "EOS 5D"}'::jsonb
);
```

## Benefits

1. **Very Specific**: Three angles + 3D coordinates = complete camera geometry
2. **Reproducible**: Can recreate exact camera setup from stored data
3. **Comparable**: Find images with similar camera geometry
4. **AI-Friendly**: AI can estimate these from image analysis
5. **Future-Proof**: Works with any camera/lens combination

