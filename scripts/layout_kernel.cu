// Mathematical port of 2swap/swaptube, release 2c7d90d, GraphSpread.cu.
// Rebuild spatial bins each step and double-buffer positions to avoid stale
// repulsion and the original in-place update race. See research/layout.md.
#include <cuda_runtime.h>
#include <cmath>
#include <cstdio>
#include <cfloat>

static constexpr int BINS=1000;
__device__ float amin(float* a,float b){int* p=(int*)a;int old=*p, assumed;do{assumed=old;if(__int_as_float(old)<=b)break;old=atomicCAS(p,assumed,__float_as_int(b));}while(old!=assumed);return __int_as_float(old);}
__device__ float amax(float* a,float b){int* p=(int*)a;int old=*p, assumed;do{assumed=old;if(__int_as_float(old)>=b)break;old=atomicCAS(p,assumed,__float_as_int(b));}while(old!=assumed);return __int_as_float(old);}
__global__ void bounds_kernel(const float4* p,int n,float* bounds){int i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=n)return;float4 q=p[i];amin(bounds,q.x);amin(bounds+1,q.y);amin(bounds+2,q.z);amax(bounds+3,q.x);amax(bounds+4,q.y);amax(bounds+5,q.z);}
__device__ int axisbin(float x,float lo,float hi){return min(9,max(0,(int)((x-lo)/fmaxf(hi-lo,1.e-6f)*10)));}
__device__ int binof(float4 p,const float* b){return axisbin(p.x,b[0],b[3])+10*axisbin(p.y,b[1],b[4])+100*axisbin(p.z,b[2],b[5]);}
__global__ void populate(const float4* p,int n,const float* bounds,int* heads,int* next,int* counts,float4* centers){int i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=n)return;int b=binof(p[i],bounds);next[i]=atomicExch(heads+b,i);atomicAdd(counts+b,1);atomicAdd(&centers[b].x,p[i].x);atomicAdd(&centers[b].y,p[i].y);atomicAdd(&centers[b].z,p[i].z);atomicAdd(&centers[b].w,p[i].w);}
__global__ void finish_centers(float4* c,const int* count){int i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=BINS||count[i]==0)return;float s=1.f/count[i];c[i].x*=s;c[i].y*=s;c[i].z*=s;c[i].w*=s;}
__device__ void repulse(float4 p,float4 q,float mass,float4& f){float x=p.x-q.x,y=p.y-q.y,z=p.z-q.z,w=p.w-q.w;float d=x*x+y*y+z*z+w*w;if(d<1.e-16f)return;float s=mass*rsqrtf(d)/(10.f*(d+1.f)+2.f);f.x+=x*s;f.y+=y*s;f.z+=z*s;f.w+=w*s;}
__global__ void integrate(const float4* p,float4* out,float4* vel,const int* adj,int degree,const int* mirrors,int n,const float* bounds,const int* heads,const int* next,const int* counts,const float4* centers,float repel,float attract,float decay,float dimension,float mirror_force,int exact){
 int i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=n)return;
 float4 q=p[i],f=make_float4(0,0,0,0),v=vel[i];
 if(exact){for(int j=0;j<n;j++)if(i!=j)repulse(q,p[j],1,f);}
 else {int b=binof(q,bounds),bx=b%10,by=(b/10)%10,bz=b/100;
   for(int j=0;j<BINS;j++){if(!counts[j])continue;
     if(abs(j%10-bx)<=1&&abs((j/10)%10-by)<=1&&abs(j/100-bz)<=1){for(int k=heads[j];k!=-1;k=next[k])if(k!=i)repulse(q,p[k],1,f);}
     else repulse(q,centers[j],counts[j],f);
   }
 }
 v.x+=repel*f.x;v.y+=repel*f.y;v.z+=repel*f.z;v.w+=repel*f.w;
 for(int k=0;k<degree;k++){int j=adj[i*degree+k];if(j<0)break;if(j>=n)continue;float4 o=p[j];float x=q.x-o.x,y=q.y-o.y,z=q.z-o.z,w=q.w-o.w;float d=x*x+y*y+z*z+w*w+1.f,t=.05f*d*d*d;float s=attract*(.2f*(t-1.f)/(t+1.f)-.1f);v.x-=s*x;v.y-=s*y;v.z-=s*z;v.w-=s*w;}
 int j=mirrors[i];if(mirror_force>.001f&&j>=0&&j<n&&j!=i){q.x+=mirror_force*(-p[j].x-q.x);q.y+=mirror_force*(p[j].y-q.y);q.z+=mirror_force*(p[j].z-q.z);}
 float speed=sqrtf(v.x*v.x+v.y*v.y+v.z*v.z+v.w*v.w);float s=decay*(speed>20.f?20.f/speed:1.f);v.x*=s;v.y*=s;v.z*=s;v.w*=s;
 out[i]=make_float4(q.x+v.x,q.y+v.y,(q.z+v.z)*fminf(1.f,fmaxf(0.f,dimension-2.f)),(q.w+v.w)*fminf(1.f,fmaxf(0.f,dimension-3.f)));vel[i]=v;
}

#define CHECK(call) do{cudaError_t e=(call);if(e!=cudaSuccess){snprintf(error,1024,"%s",cudaGetErrorString(e));goto cleanup;}}while(0)
extern "C" int run_layout(float* hp,float* hv,const int* ha,const int* hm,int n,int degree,int steps,float repel,float attract,float decay,float dimension,float mirror_force,int exact,char* error){
 float4 *p=nullptr,*out=nullptr,*v=nullptr,*centers=nullptr;float* bounds=nullptr;
 int *adj=nullptr,*mirrors=nullptr,*heads=nullptr,*next=nullptr,*counts=nullptr;int result=1;
 const size_t bytes=n*sizeof(float4);int blocks=(n+127)/128;
 CHECK(cudaMalloc(&p,bytes));CHECK(cudaMalloc(&out,bytes));CHECK(cudaMalloc(&v,bytes));CHECK(cudaMalloc(&adj,n*degree*sizeof(int)));CHECK(cudaMalloc(&mirrors,n*sizeof(int)));
 CHECK(cudaMalloc(&bounds,6*sizeof(float)));CHECK(cudaMalloc(&centers,BINS*sizeof(float4)));CHECK(cudaMalloc(&heads,BINS*sizeof(int)));CHECK(cudaMalloc(&counts,BINS*sizeof(int)));CHECK(cudaMalloc(&next,n*sizeof(int)));
 CHECK(cudaMemcpy(p,hp,bytes,cudaMemcpyHostToDevice));CHECK(cudaMemcpy(v,hv,bytes,cudaMemcpyHostToDevice));CHECK(cudaMemcpy(adj,ha,n*degree*sizeof(int),cudaMemcpyHostToDevice));CHECK(cudaMemcpy(mirrors,hm,n*sizeof(int),cudaMemcpyHostToDevice));
 for(int step=0;step<steps;step++){
   if(!exact){float init[6]={FLT_MAX,FLT_MAX,FLT_MAX,-FLT_MAX,-FLT_MAX,-FLT_MAX};CHECK(cudaMemcpy(bounds,init,sizeof(init),cudaMemcpyHostToDevice));CHECK(cudaMemset(heads,255,BINS*sizeof(int)));CHECK(cudaMemset(counts,0,BINS*sizeof(int)));CHECK(cudaMemset(centers,0,BINS*sizeof(float4)));
     bounds_kernel<<<blocks,128>>>(p,n,bounds);populate<<<blocks,128>>>(p,n,bounds,heads,next,counts,centers);finish_centers<<<8,128>>>(centers,counts);
   }
   integrate<<<blocks,128>>>(p,out,v,adj,degree,mirrors,n,bounds,heads,next,counts,centers,repel,attract,decay,dimension,mirror_force,exact);float4* tmp=p;p=out;out=tmp;
 }
 CHECK(cudaGetLastError());CHECK(cudaDeviceSynchronize());CHECK(cudaMemcpy(hp,p,bytes,cudaMemcpyDeviceToHost));CHECK(cudaMemcpy(hv,v,bytes,cudaMemcpyDeviceToHost));result=0;
 cleanup:cudaFree(p);cudaFree(out);cudaFree(v);cudaFree(adj);cudaFree(mirrors);cudaFree(bounds);cudaFree(centers);cudaFree(heads);cudaFree(counts);cudaFree(next);return result;
}
