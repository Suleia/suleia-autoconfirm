import os,sys,pathlib,json
WORKSPACE=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(WORKSPACE))
import shopify_web_tools as api
for p in [WORKSPACE/'.env',WORKSPACE/'autoconfirm/.env']:api.load_env_file(p)
SHOP=os.environ.get('SHOPIFY_DOMAIN') or os.environ.get('SHOPIFY_SHOP')
assert SHOP=='vcnby0-h1.myshopify.com'
VERSION=os.environ.get('SHOPIFY_API_VERSION');assert VERSION
TOKEN=api.get_access_token(SHOP,os.environ['SHOPIFY_CLIENT_ID'],os.environ['SHOPIFY_CLIENT_SECRET'])
MAIN=198240600396
def gql(q,v=None):
 r=api.shopify_rest(SHOP,VERSION,TOKEN,'POST','graphql.json',{'query':q,'variables':v or {}})
 if r.get('errors'):raise RuntimeError('GRAPHQL_FAILED')
 return r['data']
def manifest(theme=MAIN):
 out={};after=None
 for _ in range(8):
  t=gql('query($id:ID!,$after:String){theme(id:$id){id role files(first:250,after:$after){nodes{filename checksumMd5}pageInfo{hasNextPage endCursor}}}}',{'id':f'gid://shopify/OnlineStoreTheme/{theme}','after':after})['theme']
  out.update({x['filename']:x['checksumMd5'] for x in t['files']['nodes']})
  if not t['files']['pageInfo']['hasNextPage']:return t['role'],out
  after=t['files']['pageInfo']['endCursor']
 raise RuntimeError('MANIFEST_INCOMPLETE')
def get_files(names,theme=MAIN):
 return gql('query($id:ID!,$names:[String!]!){theme(id:$id){id role files(first:50,filenames:$names){nodes{filename checksumMd5 body{... on OnlineStoreThemeFileBodyText{content}}}}}}',{'id':f'gid://shopify/OnlineStoreTheme/{theme}','names':names})['theme']['files']['nodes']
