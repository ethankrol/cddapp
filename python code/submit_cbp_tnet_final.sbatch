#!/bin/bash
#SBATCH --job-name=cbp_tnet_v4_final
#SBATCH --output=/orange/xiangyan/rithika/cdd/logs/cbp_tnet_%j.log
#SBATCH --error=/orange/xiangyan/rithika/cdd/logs/cbp_tnet_%j.err
#SBATCH --partition=hpg-b200
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=64gb
#SBATCH --gres=gpu:1
#SBATCH --time=08:00:00
#SBATCH --mail-type=END,FAIL
#SBATCH --mail-user=rithika.mathew@ufl.edu

# ─────────────────────────────────────────────────────────────────────────────
# cBP-Tnet v4 Final — SLURM submission script
# ─────────────────────────────────────────────────────────────────────────────

BASE_DIR=/orange/xiangyan/rithika/cdd
LOG_DIR=${BASE_DIR}/logs
mkdir -p ${LOG_DIR}
mkdir -p ${BASE_DIR}/outputs

echo "============================================"
echo " cBP-Tnet v4 Final Training Job"
echo " Job ID   : ${SLURM_JOB_ID}"
echo " Node     : $(hostname)"
echo " Started  : $(date)"
echo "============================================"

# ── Environment ──────────────────────────────────────────────────────────────
module purge
module load pytorch/2.8.0   # loads Python 3.13.5, CUDA 12.8, cuDNN

echo "Python : $(which python)  ($(python --version))"
echo "PyTorch: $(python -c 'import torch; print(torch.__version__)')"
echo "CUDA   : $(python -c 'import torch; print(torch.cuda.is_available())')"
echo ""

# Quick import check
python -c "
import torch, numpy, scipy, pyampd, seaborn, tqdm, pandas
print('All core imports OK')
" || { echo "Import check failed"; exit 1; }

# ── Dataset check ─────────────────────────────────────────────────────────────
DATASET_ROOT=${BASE_DIR}/mimic_bp
if [ ! -d "${DATASET_ROOT}/ppg" ] || [ ! -d "${DATASET_ROOT}/abp" ] || \
   [ ! -d "${DATASET_ROOT}/labels" ]; then
    echo "ERROR: MIMIC-BP dataset not found at ${DATASET_ROOT}"
    echo "  Expected: ppg/, abp/, labels/, train_subjects.txt, val_subjects.txt, test_subjects.txt"
    exit 1
fi
echo "MIMIC-BP dataset found at ${DATASET_ROOT}"

# ── GPU info ──────────────────────────────────────────────────────────────────
echo ""
echo "--- GPU Info ---"
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
echo ""

# ── Run ───────────────────────────────────────────────────────────────────────
echo "--- Starting cBP-Tnet v4 Final training ---"
export BASE_DIR=${BASE_DIR}

python ${BASE_DIR}/cbp_tnet_train_v4_final.py

EXIT_CODE=$?

echo ""
echo "============================================"
echo " Job finished : $(date)"
echo " Exit code    : ${EXIT_CODE}"
echo " Outputs in   : ${BASE_DIR}/outputs"
echo "============================================"

exit ${EXIT_CODE}
