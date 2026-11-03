#!/bin/sh
# Compress the prepared models for the web: weld, simplify (meshoptimizer), meshopt geometry
# compression, WebP textures. Meshes are not joined, so every "<part>|<slot>" mesh stays clickable.
#   tools/models/optimize.sh <prepared dir> <output dir>
set -e
in=$1; out=$2; mkdir -p "$out"
gt="npx --yes @gltf-transform/cli@4.1.1"
opts="--compress meshopt --join false --palette false --instance false --texture-compress webp --texture-size 1024"
$gt optimize "$in/car-2026-.glb" "$out/car-2026.glb" $opts --simplify-ratio 0.3 --simplify-error 0.0006
$gt optimize "$in/car-2022-2025.glb" "$out/car-2022-2025.glb" $opts --simplify-ratio 0.2 --simplify-error 0.0006
$gt optimize "$in/car-2017-2021.glb" "$out/car-2017-2021.glb" $opts --simplify-ratio 0.6 --simplify-error 0.0006
$gt optimize "$in/helmet.glb" "$out/helmet.glb" $opts --simplify-ratio 0.6 --simplify-error 0.0003
cp "$in/car-2026-.json" "$out/car-2026.json"
cp "$in/car-2022-2025.json" "$out/car-2022-2025.json"
cp "$in/car-2017-2021.json" "$out/car-2017-2021.json"
