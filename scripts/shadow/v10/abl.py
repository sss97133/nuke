import numpy as np,sys
src=open('final_v10.py').read().replace("exec(open('gbm_v10.py').read().split('grid=')[0])","exec(open('gbm_v10.py').read().split('grid=')[0]); exec(EXTRA)").split('json.dump(dict')[0]
EXTRA=sys.argv[1]
src=src.replace("rep={}","lv=np.load('../v9/sets_v9.npz')['lv']\nrep={}")
exec(src)
