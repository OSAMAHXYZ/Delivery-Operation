# 3D Car Models Directory

This directory is for storing 3D car model files in GLTF or GLB format.

## Supported Formats
- **.glb** (recommended) - Binary GLTF format, single file
- **.gltf** - Text-based GLTF format (requires separate .bin and texture files)

## File Naming Convention
Name your 3D model files to match the car names:
- `camry.glb` - For Camry
- `prado.glb` - For Prado
- `corolla.glb` - For Corolla
- etc.

## How to Add 3D Models

1. Place your `.glb` or `.gltf` file in this directory
2. Update the `car3DModelMap` in `simple-app.html`:
   ```javascript
   const car3DModelMap = {
       'Camry': 'images/cars/3d/camry.glb',
       'Prado': 'images/cars/3d/prado.glb',
       // Add more as needed
   };
   ```

## Where to Get 3D Models

- **Sketchfab** - https://sketchfab.com (many free models available)
- **TurboSquid** - https://www.turbosquid.com
- **CGTrader** - https://www.cgtrader.com
- **Toyota Official** - Check if Toyota provides 3D models for their vehicles

## Model Requirements

- **File Size**: Keep under 10MB for best performance
- **Polygon Count**: Optimize to under 100k polygons if possible
- **Textures**: Include textures for best visual quality
- **Format**: GLB format is preferred (single file, faster loading)

## Notes

- If a 3D model is not available, the app will automatically fall back to the 2D image
- Users can toggle between 3D and 2D views if both are available
- 3D models support interactive rotation and zoom

