// Diagnostic force fields. CPU-2024 formulas: 2swap/swaptube 1384210,
// src/scenes/Graph.cpp. Release formulas: 2c7d90d, src/CUDA/GraphSpread.cu.
// No time integration: test whether a coordinate snapshot resembles equilibrium.
#include <cuda_runtime.h>
#include <cmath>
#include <cstdio>

__global__ void fields(const double* p, const int* sample, const int* adj,
                       int n, int m, int degree, double scale, int law, double* out) {
    int k = blockIdx.x * blockDim.x + threadIdx.x;
    if (k >= m) return;
    int i = sample[k];
    double r[3] = {}, a[3] = {};
    for (int j = 0; j < n; ++j) {
        if (i == j) continue;
        double d[3], r2 = 0;
        for (int c=0;c<3;++c) {d[c]=(p[i*3+c]-p[j*3+c])*scale;r2+=d[c]*d[c];}
        double f;
        if (law==0) f=r2>1e-24 ? 1/(sqrt(r2)*(10*(r2+1)+2)) : 0;
        else if (law==1) f=.5/(r2+.1);
        else f=.0025/((r2+.1)*(r2+.1));
        for(int c=0;c<3;++c) r[c]+=d[c]*f;
    }
    for(int k2=0;k2<degree;++k2) {
        int j=adj[i*degree+k2];if(j<0) break;
        double d[3], r2=0;
        for(int c=0;c<3;++c) {d[c]=(p[i*3+c]-p[j*3+c])*scale;r2+=d[c]*d[c];}
        double f;
        if(law==0) {double t=.05*pow(r2+1,3);f=.2*(t-1)/(t+1)-.1;}
        else if(law==1) f=.5*r2/(r2+1);
        else f=1/(r2+1)+r2-1;
        for(int c=0;c<3;++c) a[c]-=d[c]*f;
    }
    for(int c=0;c<3;++c) {out[k*6+c]=r[c];out[k*6+c+3]=a[c];}
}

extern "C" int force_fields(const double* p,const int* sample,const int* adj,
                            int n,int m,int degree,double scale,int law,double* out) {
    double *dp=nullptr,*dout=nullptr;int *ds=nullptr,*da=nullptr;int status=1;
#define TRY(x) if((x)!=cudaSuccess) goto cleanup
    TRY(cudaMalloc(&dp,n*3*sizeof(double)));TRY(cudaMalloc(&dout,m*6*sizeof(double)));
    TRY(cudaMalloc(&ds,m*sizeof(int)));TRY(cudaMalloc(&da,n*degree*sizeof(int)));
    TRY(cudaMemcpy(dp,p,n*3*sizeof(double),cudaMemcpyHostToDevice));
    TRY(cudaMemcpy(ds,sample,m*sizeof(int),cudaMemcpyHostToDevice));
    TRY(cudaMemcpy(da,adj,n*degree*sizeof(int),cudaMemcpyHostToDevice));
    fields<<<(m+127)/128,128>>>(dp,ds,da,n,m,degree,scale,law,dout);
    TRY(cudaGetLastError());TRY(cudaDeviceSynchronize());
    TRY(cudaMemcpy(out,dout,m*6*sizeof(double),cudaMemcpyDeviceToHost));status=0;
cleanup:
    cudaFree(dp);cudaFree(dout);cudaFree(ds);cudaFree(da);return status;
}
