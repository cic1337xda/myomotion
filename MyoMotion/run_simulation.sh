#!/usr/bin/env bash
# ==============================================================================
# Run the MyoMotion hardware node simulator inside the existing backend container
# Usage: ./run_simulation.sh
# Or specify MAC address: ./run_simulation.sh --mac CC7B5C284994 --mode elbow
# ==============================================================================

echo "================================================================="
echo "  Launching MyoMotion Hardware Simulator inside Docker Container  "
echo "  Press Ctrl+C to terminate simulation at anytime                 "
echo "================================================================="

docker exec -it myomotion_backend python /app/simulate_node.py --host myomotion_mqtt --port 1883 "$@"
