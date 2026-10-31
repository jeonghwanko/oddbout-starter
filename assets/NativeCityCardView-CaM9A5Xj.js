import{a as e}from"./rolldown-runtime-B0Z9INg1.js";import{M as t,O as n,R as r,S as i,T as a,i as o,j as s,k as c}from"./depths-DtOEy-CR.js";import{c as l}from"./palette-D63XinfX.js";import{t as u}from"./GameCanvasUnderlay-BNdrtbke.js";import{t as d}from"./CityEnvironment-AhQf9g8O.js";import{$ as f,J as p,Q as m,X as h,b as g,et as _}from"./NativeCityMelee-BmlTGALC.js";import{a as v,c as y,i as b,o as x,r as S,s as C,t as w}from"./NativeCityKtx2Files-Dul-48yz.js";import{M as T,S as E,_ as D,f as O,g as k,h as A,i as j,l as M,m as N,p as ee,r as P,t as te,v as ne,w as re,x as ie,y as ae}from"./NativeCityTreeShadow-BFCyaTS8.js";import{A as F,B as oe,C as I,F as se,L as ce,M as le,N as ue,O as de,R as fe,S as pe,T as me,b as he,i as ge,j as _e,k as ve,l as ye,m as be,n as L,p as xe,r as R,v as Se,w as z,y as Ce,z as B}from"./NativeCityFloorDecal-B6zMIZhV.js";import{i as V,n as we,r as Te,t as H}from"./native-city-art-finish-BZDHQ1na.js";import{a as Ee,i as De,n as Oe,o as ke,r as Ae,t as je}from"./NativeCityBuildingGrade-Ba1maCQ1.js";import{$ as Me,A as Ne,An as Pe,B as Fe,C as Ie,Cn as Le,D as Re,Dn as U,En as ze,F as Be,G as W,Gt as Ve,H as He,I as Ue,J as We,Jt as Ge,K as Ke,Kt as qe,L as Je,M as Ye,Mn as Xe,N as Ze,Nn as G,O as Qe,On as $e,Pn as et,Q as tt,R as nt,S as rt,Sn as it,T as at,Tn as ot,U as st,Ut as ct,V as lt,Wt as ut,X as dt,Y as ft,Yt as pt,Z as mt,_ as ht,_n as gt,a as _t,at as vt,b as yt,bn as K,c as bt,cn as xt,ct as St,d as Ct,en as wt,et as Tt,fn as Et,ft as Dt,g as Ot,gn as kt,h as At,hn as jt,i as Mt,in as Nt,it as Pt,jn as Ft,k as It,kn as Lt,l as Rt,ln as zt,m as Bt,mn as Vt,n as Ht,nn as Ut,nt as Wt,on as Gt,ot as Kt,pt as qt,q,qt as Jt,r as Yt,rn as J,rt as Xt,s as Zt,sn as Qt,tn as $t,u as Y,un as en,v as tn,vn as X,w as nn,wn as rn,x as an,xn as on,y as sn,yn as Z,z as cn}from"./three.core-Dt6LFlTl.js";import{n as ln,t as un}from"./NativeCityShopLightmap-Dq9ySLfR.js";import{a as dn,c as fn,n as pn,o as mn,s as hn}from"./NativeCityWallRelief-DgaUovU8.js";import{n as gn}from"./NativeCityCompressedTexture-CjxL7kCm.js";import{a as _n,c as vn,l as yn,n as bn,o as xn,r as Sn,s as Cn,t as wn}from"./NativeCityPaintedFacePlan-Bd27WAXL.js";import{n as Tn,r as En,t as Dn}from"./NativeCityStreetFinishView-BOD7wwtc.js";import{n as On,t as kn}from"./NativeCityTownKitView-BgmzW8OR.js";function An(){let e=null,t=!1,n=null,r=null;function i(t,a){r=e.requestAnimationFrame(i),n(t,a)}return{start:function(){t!==!0&&n!==null&&e!==null&&(r=e.requestAnimationFrame(i),t=!0)},stop:function(){e!==null&&e.cancelAnimationFrame(r),t=!1},setAnimationLoop:function(e){n=e},setContext:function(t){e=t}}}function jn(e){let t=new WeakMap;function n(t,n){let r=t.array,i=t.usage,a=r.byteLength,o=e.createBuffer();e.bindBuffer(n,o),e.bufferData(n,r,i),t.onUploadCallback();let s;if(r instanceof Float32Array)s=e.FLOAT;else if(typeof Float16Array<`u`&&r instanceof Float16Array)s=e.HALF_FLOAT;else if(r instanceof Uint16Array)s=t.isFloat16BufferAttribute?e.HALF_FLOAT:e.UNSIGNED_SHORT;else if(r instanceof Int16Array)s=e.SHORT;else if(r instanceof Uint32Array)s=e.UNSIGNED_INT;else if(r instanceof Int32Array)s=e.INT;else if(r instanceof Int8Array)s=e.BYTE;else if(r instanceof Uint8Array)s=e.UNSIGNED_BYTE;else if(r instanceof Uint8ClampedArray)s=e.UNSIGNED_BYTE;else throw Error(`THREE.WebGLAttributes: Unsupported buffer data format: `+r);return{buffer:o,type:s,bytesPerElement:r.BYTES_PER_ELEMENT,version:t.version,size:a}}function r(t,n,r){let i=n.array,a=n.updateRanges;if(e.bindBuffer(r,t),a.length===0)e.bufferSubData(r,0,i);else{a.sort((e,t)=>e.start-t.start);let t=0;for(let e=1;e<a.length;e++){let n=a[t],r=a[e];r.start<=n.start+n.count+1?n.count=Math.max(n.count,r.start+r.count-n.start):(++t,a[t]=r)}a.length=t+1;for(let t=0,n=a.length;t<n;t++){let n=a[t];e.bufferSubData(r,n.start*i.BYTES_PER_ELEMENT,i,n.start,n.count)}n.clearUpdateRanges()}n.onUploadCallback()}function i(e){return e.isInterleavedBufferAttribute&&(e=e.data),t.get(e)}function a(n){n.isInterleavedBufferAttribute&&(n=n.data);let r=t.get(n);r&&(e.deleteBuffer(r.buffer),t.delete(n))}function o(e,i){if(e.isInterleavedBufferAttribute&&(e=e.data),e.isGLBufferAttribute){let n=t.get(e);(!n||n.version<e.version)&&t.set(e,{buffer:e.buffer,type:e.type,bytesPerElement:e.elementSize,version:e.version});return}let a=t.get(e);if(a===void 0)t.set(e,n(e,i));else if(a.version<e.version){if(a.size!==e.array.byteLength)throw Error(`THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.`);r(a.buffer,e,i),a.version=e.version}}return{get:i,remove:a,update:o}}var Q={alphahash_fragment:`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,alphahash_pars_fragment:`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,alphamap_fragment:`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,alphamap_pars_fragment:`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,alphatest_fragment:`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,alphatest_pars_fragment:`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,aomap_fragment:`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,aomap_pars_fragment:`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,batching_pars_vertex:`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,batching_vertex:`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,begin_vertex:`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,beginnormal_vertex:`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,bsdfs:`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,iridescence_fragment:`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,bumpmap_pars_fragment:`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,clipping_planes_fragment:`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,clipping_planes_pars_fragment:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,clipping_planes_pars_vertex:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,clipping_planes_vertex:`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,color_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,color_pars_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,color_pars_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,color_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,common:`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,cube_uv_reflection_fragment:`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,defaultnormal_vertex:`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,displacementmap_pars_vertex:`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,displacementmap_vertex:`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,emissivemap_fragment:`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,emissivemap_pars_fragment:`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,colorspace_fragment:`gl_FragColor = linearToOutputTexel( gl_FragColor );`,colorspace_pars_fragment:`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,envmap_fragment:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,envmap_common_pars_fragment:`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,envmap_pars_fragment:`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,envmap_pars_vertex:`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,envmap_physical_pars_fragment:`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_RETROREFLECTION
		vec3 getIBLRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 retroVec = normalize( mix( viewDir, normal, pow4( roughness ) ) );
				retroVec = transformDirectionByInverseViewMatrix( retroVec, viewMatrix );
				vec4 envMapColor = textureCubeUV( envMap, envMapRotation * retroVec, roughness );
				return envMapColor.rgb * envMapIntensity;
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
		#ifdef USE_RETROREFLECTION
			vec3 getIBLAnisotropyRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
				#ifdef ENVMAP_TYPE_CUBE_UV
					vec3 bentNormal = cross( bitangent, viewDir );
					bentNormal = normalize( cross( bentNormal, bitangent ) );
					bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
					return getIBLRetroRadiance( viewDir, bentNormal, roughness );
				#else
					return vec3( 0.0 );
				#endif
			}
		#endif
	#endif
#endif`,envmap_vertex:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,fog_vertex:`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,fog_pars_vertex:`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,fog_fragment:`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,fog_pars_fragment:`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,gradientmap_pars_fragment:`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,lightmap_pars_fragment:`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,lights_lambert_fragment:`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,lights_lambert_pars_fragment:`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,lights_pars_begin:`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_SUN_LIGHTS > 0
	struct SunLight {
		vec3 direction;
		vec3 color;
	};
	uniform SunLight sunLights[ NUM_SUN_LIGHTS ];
	void getSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
		light.color = sunLight.color;
		light.direction = sunLight.direction;
		light.visible = true;
	}
#endif
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,lights_toon_fragment:`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,lights_toon_pars_fragment:`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,lights_phong_fragment:`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,lights_phong_pars_fragment:`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,lights_physical_fragment:`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_RETROREFLECTION
	material.retroreflectivity = retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,lights_physical_pars_fragment:`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	vec2 dfg;
	vec3 multiScatteringCompensation;
	#ifdef USE_RETROREFLECTION
		float retroreflectivity;
	#endif
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0Dielectric;
		vec3 iridescenceF0Metallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#ifdef USE_RETROREFLECTION
		vec3 retroViewDir = reflect( - geometryViewDir, geometryNormal );
		vec3 retroSpecularBRDF = BRDF_GGX( directLight.direction, retroViewDir, geometryNormal, material );
		specularBRDF = mix( specularBRDF, retroSpecularBRDF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotVH = saturate( dot( geometryViewDir, halfDir ) );
	vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
	#ifdef USE_RETROREFLECTION
		vec3 retroHalfDir = normalize( directLight.direction + retroViewDir );
		float dotRetroVH = saturate( dot( retroViewDir, retroHalfDir ) );
		vec3 retroF = F_Schlick( material.specularColor, material.specularF90, dotRetroVH );
		F = mix( F, retroF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
	#endif
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,lights_fragment_begin:`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
		material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
	}
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
	SunLight sunLight;
	#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
		sunLight = sunLights[ i ];
		getSunLightInfo( sunLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SUN_LIGHT_SHADOWS )
		sunLightShadow = sunLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,lights_fragment_maps:`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		vec3 iblRadiance = getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_RETROREFLECTION
		#ifdef USE_ANISOTROPY
			vec3 retroIBLRadiance = getIBLAnisotropyRetroRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
		#else
			vec3 retroIBLRadiance = getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness );
		#endif
		iblRadiance = mix( iblRadiance, retroIBLRadiance, saturate( material.retroreflectivity ) );
	#endif
	radiance += iblRadiance;
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,lights_fragment_end:`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,lightprobes_pars_fragment:`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,logdepthbuf_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,logdepthbuf_pars_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_pars_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,map_fragment:`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,map_pars_fragment:`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,map_particle_fragment:`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,map_particle_pars_fragment:`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,metalnessmap_fragment:`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,metalnessmap_pars_fragment:`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,morphinstance_vertex:`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,morphcolor_vertex:`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,morphnormal_vertex:`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,morphtarget_pars_vertex:`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,morphtarget_vertex:`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,normal_fragment_begin:`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,normal_fragment_maps:`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,normal_pars_fragment:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_pars_vertex:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_vertex:`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,normalmap_pars_fragment:`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,clearcoat_normal_fragment_begin:`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,clearcoat_normal_fragment_maps:`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,clearcoat_pars_fragment:`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,iridescence_pars_fragment:`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,opaque_fragment:`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,packing:`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,premultiplied_alpha_fragment:`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,project_vertex:`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,dithering_fragment:`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,dithering_pars_fragment:`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,roughnessmap_fragment:`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,roughnessmap_pars_fragment:`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,shadowmap_pars_fragment:`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		#define SUN_LIGHT_CASCADES 2
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#else
			uniform sampler2D sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#endif
		uniform mat4 sunShadowMatrix[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		uniform vec4 sunShadowCascade[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
		struct SunLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SunLightShadow sunLightShadows[ NUM_SUN_LIGHT_SHADOWS ];
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_SUN_LIGHT_SHADOWS > 0
		float getSunShadow(
			#if defined( SHADOWMAP_TYPE_PCF )
				sampler2DShadow shadowMap,
			#else
				sampler2D shadowMap,
			#endif
			SunLightShadow sunLightShadow,
			int shadowIndex
		) {
			vec4 shadowWorldPosition = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			float viewDepth = vSunShadowWorldPosition.w;
			int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
			float shadow = 1.0;
			for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
				vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
				if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
					float cascadeShadow = getShadow(
						shadowMap,
						sunLightShadow.shadowMapSize,
						sunLightShadow.shadowIntensity,
						sunLightShadow.shadowBias,
						sunLightShadow.shadowRadius,
						sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition
					);
					shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
				}
			}
			return shadow;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,shadowmap_pars_vertex:`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,shadowmap_vertex:`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_SUN_LIGHT_SHADOWS > 0
		vSunShadowWorldPosition = vec4( worldPosition.xyz, - mvPosition.z );
		vSunShadowWorldNormal = shadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,shadowmask_pars_fragment:`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHT_SHADOWS; i ++ ) {
		sunLight = sunLightShadows[ i ];
		shadow *= receiveShadow ? getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,skinbase_vertex:`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,skinning_pars_vertex:`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,skinning_vertex:`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,skinnormal_vertex:`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,specularmap_fragment:`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,specularmap_pars_fragment:`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,tonemapping_fragment:`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,tonemapping_pars_fragment:`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,transmission_fragment:`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,transmission_pars_fragment:`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,uv_pars_fragment:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_pars_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,worldpos_vertex:`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,background_vert:`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,background_frag:`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,backgroundCube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,backgroundCube_frag:`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,cube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,cube_frag:`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,depth_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,depth_frag:`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,distance_vert:`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,distance_frag:`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,equirect_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,equirect_frag:`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,linedashed_vert:`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,linedashed_frag:`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,meshbasic_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,meshbasic_frag:`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshlambert_vert:`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshlambert_frag:`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshmatcap_vert:`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,meshmatcap_frag:`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshnormal_vert:`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,meshnormal_frag:`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,meshphong_vert:`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshphong_frag:`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshphysical_vert:`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,meshphysical_frag:`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_RETROREFLECTION
	uniform float retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshtoon_vert:`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshtoon_frag:`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,points_vert:`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,points_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,shadow_vert:`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,shadow_frag:`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,sprite_vert:`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,sprite_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`},$={common:{diffuse:{value:new Y(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new W},alphaMap:{value:null},alphaMapTransform:{value:new W},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new W}},envmap:{envMap:{value:null},envMapRotation:{value:new W},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new W}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new W}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new W},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new W},normalScale:{value:new X(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new W},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new W}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new W}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new W}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Y(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},sunLights:{value:[],properties:{direction:{},color:{}}},sunLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},sunShadowMatrix:{value:[]},sunShadowCascade:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new Z},probesMax:{value:new Z},probesResolution:{value:new Z}},points:{diffuse:{value:new Y(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new W},alphaTest:{value:0},uvTransform:{value:new W}},sprite:{diffuse:{value:new Y(16777215)},opacity:{value:1},center:{value:new X(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new W},alphaMap:{value:null},alphaMapTransform:{value:new W},alphaTest:{value:0}}},Mn={basic:{uniforms:Ft([$.common,$.specularmap,$.envmap,$.aomap,$.lightmap,$.fog]),vertexShader:Q.meshbasic_vert,fragmentShader:Q.meshbasic_frag},lambert:{uniforms:Ft([$.common,$.specularmap,$.envmap,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.fog,$.lights,{emissive:{value:new Y(0)},envMapIntensity:{value:1}}]),vertexShader:Q.meshlambert_vert,fragmentShader:Q.meshlambert_frag},phong:{uniforms:Ft([$.common,$.specularmap,$.envmap,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.fog,$.lights,{emissive:{value:new Y(0)},specular:{value:new Y(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Q.meshphong_vert,fragmentShader:Q.meshphong_frag},standard:{uniforms:Ft([$.common,$.envmap,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.roughnessmap,$.metalnessmap,$.fog,$.lights,{emissive:{value:new Y(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Q.meshphysical_vert,fragmentShader:Q.meshphysical_frag},toon:{uniforms:Ft([$.common,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.gradientmap,$.fog,$.lights,{emissive:{value:new Y(0)}}]),vertexShader:Q.meshtoon_vert,fragmentShader:Q.meshtoon_frag},matcap:{uniforms:Ft([$.common,$.bumpmap,$.normalmap,$.displacementmap,$.fog,{matcap:{value:null}}]),vertexShader:Q.meshmatcap_vert,fragmentShader:Q.meshmatcap_frag},points:{uniforms:Ft([$.points,$.fog]),vertexShader:Q.points_vert,fragmentShader:Q.points_frag},dashed:{uniforms:Ft([$.common,$.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Q.linedashed_vert,fragmentShader:Q.linedashed_frag},depth:{uniforms:Ft([$.common,$.displacementmap]),vertexShader:Q.depth_vert,fragmentShader:Q.depth_frag},normal:{uniforms:Ft([$.common,$.bumpmap,$.normalmap,$.displacementmap,{opacity:{value:1}}]),vertexShader:Q.meshnormal_vert,fragmentShader:Q.meshnormal_frag},sprite:{uniforms:Ft([$.sprite,$.fog]),vertexShader:Q.sprite_vert,fragmentShader:Q.sprite_frag},background:{uniforms:{uvTransform:{value:new W},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Q.background_vert,fragmentShader:Q.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new W}},vertexShader:Q.backgroundCube_vert,fragmentShader:Q.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Q.cube_vert,fragmentShader:Q.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Q.equirect_vert,fragmentShader:Q.equirect_frag},distance:{uniforms:Ft([$.common,$.displacementmap,{referencePosition:{value:new Z},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Q.distance_vert,fragmentShader:Q.distance_frag},shadow:{uniforms:Ft([$.lights,$.fog,{color:{value:new Y(0)},opacity:{value:1}}]),vertexShader:Q.shadow_vert,fragmentShader:Q.shadow_frag}};Mn.physical={uniforms:Ft([Mn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new W},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new W},clearcoatNormalScale:{value:new X(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new W},dispersion:{value:0},retroreflectivity:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new W},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new W},sheen:{value:0},sheenColor:{value:new Y(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new W},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new W},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new W},transmissionSamplerSize:{value:new X},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new W},attenuationDistance:{value:0},attenuationColor:{value:new Y(0)},specularColor:{value:new Y(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new W},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new W},anisotropyVector:{value:new X},anisotropyMap:{value:null},anisotropyMapTransform:{value:new W}}]),vertexShader:Q.meshphysical_vert,fragmentShader:Q.meshphysical_frag};var Nn={r:0,b:0,g:0},Pn=new Ke,Fn=new W;Fn.set(-1,0,0,0,1,0,0,0,1);function In(e,t,n,r,i,a){let o=new Y(0),s=i===!0?0:1,c,l,u=null,d=0,f=null;function p(e){let n=e.isScene===!0?e.background:null;if(n&&n.isTexture){let r=e.backgroundBlurriness>0;n=t.get(n,r)}return n}function m(t){let r=!1,i=p(t);i===null?g(o,s):i&&i.isColor&&(g(i,1),r=!0);let c=e.xr.getEnvironmentBlendMode();c===`additive`?n.buffers.color.setClear(0,0,0,1,a):c===`alpha-blend`&&n.buffers.color.setClear(0,0,0,0,a),(e.autoClear||r)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil))}function h(t,n){let i=p(n);i&&(i.isCubeTexture||i.mapping===306)?(l===void 0&&(l=new q(new Yt(1,1,1),new J({name:`BackgroundCubeMaterial`,uniforms:rn(Mn.backgroundCube.uniforms),vertexShader:Mn.backgroundCube.vertexShader,fragmentShader:Mn.backgroundCube.fragmentShader,side:1,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute(`normal`),l.geometry.deleteAttribute(`uv`),l.onBeforeRender=function(e,t,n){this.matrixWorld.copyPosition(n.matrixWorld)},Object.defineProperty(l.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),r.update(l)),l.material.uniforms.envMap.value=i,l.material.uniforms.backgroundBlurriness.value=n.backgroundBlurriness,l.material.uniforms.backgroundIntensity.value=n.backgroundIntensity,l.material.uniforms.backgroundRotation.value.setFromMatrix4(Pn.makeRotationFromEuler(n.backgroundRotation)).transpose(),i.isCubeTexture&&i.isRenderTargetTexture===!1&&l.material.uniforms.backgroundRotation.value.premultiply(Fn),l.material.toneMapped=Ct.getTransfer(i.colorSpace)!==$t,(u!==i||d!==i.version||f!==e.toneMapping)&&(l.material.needsUpdate=!0,u=i,d=i.version,f=e.toneMapping),l.layers.enableAll(),t.unshift(l,l.geometry,l.material,0,0,null)):i&&i.isTexture&&(c===void 0&&(c=new q(new vt(2,2),new J({name:`BackgroundMaterial`,uniforms:rn(Mn.background.uniforms),vertexShader:Mn.background.vertexShader,fragmentShader:Mn.background.fragmentShader,side:0,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute(`normal`),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),r.update(c)),c.material.uniforms.t2D.value=i,c.material.uniforms.backgroundIntensity.value=n.backgroundIntensity,c.material.toneMapped=Ct.getTransfer(i.colorSpace)!==$t,i.matrixAutoUpdate===!0&&i.updateMatrix(),c.material.uniforms.uvTransform.value.copy(i.matrix),(u!==i||d!==i.version||f!==e.toneMapping)&&(c.material.needsUpdate=!0,u=i,d=i.version,f=e.toneMapping),c.layers.enableAll(),t.unshift(c,c.geometry,c.material,0,0,null))}function g(t,r){t.getRGB(Nn,Lt(e)),n.buffers.color.setClear(Nn.r,Nn.g,Nn.b,r,a)}function _(){l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0),c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0)}return{getClearColor:function(){return o},setClearColor:function(e,t=1){o.set(e),s=t,g(o,s)},getClearAlpha:function(){return s},setClearAlpha:function(e){s=e,g(o,s)},render:m,addToRenderList:h,dispose:_}}function Ln(e,t){let n=e.getParameter(e.MAX_VERTEX_ATTRIBS),r={},i=f(null),a=i,o=!1;function s(n,r,i,s,c){let u=!1,f=d(n,s,i,r);a!==f&&(a=f,l(a.object)),u=p(n,s,i,c),u&&m(n,s,i,c),c!==null&&t.update(c,e.ELEMENT_ARRAY_BUFFER),(u||o)&&(o=!1,b(n,r,i,s),c!==null&&e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,t.get(c).buffer))}function c(){return e.createVertexArray()}function l(t){return e.bindVertexArray(t)}function u(t){return e.deleteVertexArray(t)}function d(e,t,n,i){let a=i.wireframe===!0,o=r[t.id];o===void 0&&(o={},r[t.id]=o);let s=e.isInstancedMesh===!0?e.id:0,l=o[s];l===void 0&&(l={},o[s]=l);let u=l[n.id];u===void 0&&(u={},l[n.id]=u);let d=u[a];return d===void 0&&(d=f(c()),u[a]=d),d}function f(e){let t=[],r=[],i=[];for(let e=0;e<n;e++)t[e]=0,r[e]=0,i[e]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:t,enabledAttributes:r,attributeDivisors:i,object:e,attributes:{},index:null}}function p(e,t,n,r){let i=a.attributes,o=t.attributes,s=0,c=n.getAttributes();for(let t in c)if(c[t].location>=0){let n=i[t],r=o[t];if(r===void 0&&(t===`instanceMatrix`&&e.instanceMatrix&&(r=e.instanceMatrix),t===`instanceColor`&&e.instanceColor&&(r=e.instanceColor)),n===void 0||n.attribute!==r||r&&n.data!==r.data)return!0;s++}return a.attributesNum!==s||a.index!==r}function m(e,t,n,r){let i={},o=t.attributes,s=0,c=n.getAttributes();for(let t in c)if(c[t].location>=0){let n=o[t];n===void 0&&(t===`instanceMatrix`&&e.instanceMatrix&&(n=e.instanceMatrix),t===`instanceColor`&&e.instanceColor&&(n=e.instanceColor));let r={};r.attribute=n,n&&n.data&&(r.data=n.data),i[t]=r,s++}a.attributes=i,a.attributesNum=s,a.index=r}function h(){let e=a.newAttributes;for(let t=0,n=e.length;t<n;t++)e[t]=0}function g(e){_(e,0)}function _(t,n){let r=a.newAttributes,i=a.enabledAttributes,o=a.attributeDivisors;r[t]=1,i[t]===0&&(e.enableVertexAttribArray(t),i[t]=1),o[t]!==n&&(e.vertexAttribDivisor(t,n),o[t]=n)}function v(){let t=a.newAttributes,n=a.enabledAttributes;for(let r=0,i=n.length;r<i;r++)n[r]!==t[r]&&(e.disableVertexAttribArray(r),n[r]=0)}function y(t,n,r,i,a,o,s){s===!0?e.vertexAttribIPointer(t,n,r,a,o):e.vertexAttribPointer(t,n,r,i,a,o)}function b(n,r,i,a){h();let o=a.attributes,s=i.getAttributes(),c=r.defaultAttributeValues;for(let r in s){let i=s[r];if(i.location>=0){let s=o[r];if(s===void 0&&(r===`instanceMatrix`&&n.instanceMatrix&&(s=n.instanceMatrix),r===`instanceColor`&&n.instanceColor&&(s=n.instanceColor)),s!==void 0){let r=s.normalized,o=s.itemSize,c=t.get(s);if(c===void 0)continue;let l=c.buffer,u=c.type,d=c.bytesPerElement,f=u===e.INT||u===e.UNSIGNED_INT||s.gpuType===1013;if(s.isInterleavedBufferAttribute){let t=s.data,c=t.stride,p=s.offset;if(t.isInstancedInterleavedBuffer){for(let e=0;e<i.locationSize;e++)_(i.location+e,t.meshPerAttribute);n.isInstancedMesh!==!0&&a._maxInstanceCount===void 0&&(a._maxInstanceCount=t.meshPerAttribute*t.count)}else for(let e=0;e<i.locationSize;e++)g(i.location+e);e.bindBuffer(e.ARRAY_BUFFER,l);for(let e=0;e<i.locationSize;e++)y(i.location+e,o/i.locationSize,u,r,c*d,(p+o/i.locationSize*e)*d,f)}else{if(s.isInstancedBufferAttribute){for(let e=0;e<i.locationSize;e++)_(i.location+e,s.meshPerAttribute);n.isInstancedMesh!==!0&&a._maxInstanceCount===void 0&&(a._maxInstanceCount=s.meshPerAttribute*s.count)}else for(let e=0;e<i.locationSize;e++)g(i.location+e);e.bindBuffer(e.ARRAY_BUFFER,l);for(let e=0;e<i.locationSize;e++)y(i.location+e,o/i.locationSize,u,r,o*d,o/i.locationSize*e*d,f)}}else if(c!==void 0){let t=c[r];if(t!==void 0)switch(t.length){case 2:e.vertexAttrib2fv(i.location,t);break;case 3:e.vertexAttrib3fv(i.location,t);break;case 4:e.vertexAttrib4fv(i.location,t);break;default:e.vertexAttrib1fv(i.location,t)}}}}v()}function x(){T();for(let e in r){let t=r[e];for(let e in t){let n=t[e];for(let e in n){let t=n[e];for(let e in t)u(t[e].object),delete t[e];delete n[e]}}delete r[e]}}function S(e){if(r[e.id]===void 0)return;let t=r[e.id];for(let e in t){let n=t[e];for(let e in n){let t=n[e];for(let e in t)u(t[e].object),delete t[e];delete n[e]}}delete r[e.id]}function C(e){for(let t in r){let n=r[t];for(let t in n){let r=n[t];if(r[e.id]===void 0)continue;let i=r[e.id];for(let e in i)u(i[e].object),delete i[e];delete r[e.id]}}}function w(e){for(let t in r){let n=r[t],i=e.isInstancedMesh===!0?e.id:0,a=n[i];if(a!==void 0){for(let e in a){let t=a[e];for(let e in t)u(t[e].object),delete t[e];delete a[e]}delete n[i],Object.keys(n).length===0&&delete r[t]}}}function T(){E(),o=!0,a!==i&&(a=i,l(a.object))}function E(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:s,reset:T,resetDefaultState:E,dispose:x,releaseStatesOfGeometry:S,releaseStatesOfObject:w,releaseStatesOfProgram:C,initAttributes:h,enableAttribute:g,disableUnusedAttributes:v}}function Rn(e,t,n){let r;function i(e){r=e}function a(t,i){e.drawArrays(r,t,i),n.update(i,r,1)}function o(t,i,a){a!==0&&(e.drawArraysInstanced(r,t,i,a),n.update(i,r,a))}function s(e,i,a){if(a===0)return;t.get(`WEBGL_multi_draw`).multiDrawArraysWEBGL(r,e,0,i,0,a);let o=0;for(let e=0;e<a;e++)o+=i[e];n.update(o,r,1)}this.setMode=i,this.render=a,this.renderInstances=o,this.renderMultiDraw=s}function zn(e,t,n,r){let i;function a(){if(i!==void 0)return i;if(t.has(`EXT_texture_filter_anisotropic`)===!0){let n=t.get(`EXT_texture_filter_anisotropic`);i=e.getParameter(n.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function o(t){return t===1023||r.convert(t)===e.getParameter(e.IMPLEMENTATION_COLOR_READ_FORMAT)}function s(n){let i=n===1016&&(t.has(`EXT_color_buffer_half_float`)||t.has(`EXT_color_buffer_float`));return!(n!==1009&&n!==1015&&!i&&r.convert(n)!==e.getParameter(e.IMPLEMENTATION_COLOR_READ_TYPE))}function c(t){if(t===`highp`){if(e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.HIGH_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.HIGH_FLOAT).precision>0)return`highp`;t=`mediump`}return t===`mediump`&&e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.MEDIUM_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.MEDIUM_FLOAT).precision>0?`mediump`:`lowp`}let l=n.precision===void 0?`highp`:n.precision,u=c(l);u!==l&&(G(`WebGLRenderer:`,l,`not supported, using`,u,`instead.`),l=u);let d=n.logarithmicDepthBuffer===!0,f=n.reversedDepthBuffer===!0&&t.has(`EXT_clip_control`);n.reversedDepthBuffer===!0&&f===!1&&G(`WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.`);let p=e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS),m=e.getParameter(e.MAX_VERTEX_TEXTURE_IMAGE_UNITS),h=e.getParameter(e.MAX_TEXTURE_SIZE),g=e.getParameter(e.MAX_CUBE_MAP_TEXTURE_SIZE),_=e.getParameter(e.MAX_VERTEX_ATTRIBS),v=e.getParameter(e.MAX_VERTEX_UNIFORM_VECTORS),y=e.getParameter(e.MAX_VARYING_VECTORS),b=e.getParameter(e.MAX_FRAGMENT_UNIFORM_VECTORS),x=e.getParameter(e.MAX_SAMPLES),S=e.getParameter(e.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:a,getMaxPrecision:c,textureFormatReadable:o,textureTypeReadable:s,precision:l,logarithmicDepthBuffer:d,reversedDepthBuffer:f,maxTextures:p,maxVertexTextures:m,maxTextureSize:h,maxCubemapSize:g,maxAttributes:_,maxVertexUniforms:v,maxVaryings:y,maxFragmentUniforms:b,maxSamples:x,samples:S}}function Bn(e){let t=this,n=null,r=0,i=!1,a=!1,o=new Pt,s=new W,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(e,t){let n=e.length!==0||t||r!==0||i;return i=t,r=e.length,n},this.beginShadows=function(){a=!0,u(null)},this.endShadows=function(){a=!1},this.setGlobalState=function(e,t){n=u(e,t,0)},this.setState=function(t,o,s){let d=t.clippingPlanes,f=t.clipIntersection,p=t.clipShadows,m=e.get(t);if(!i||d===null||d.length===0||a&&!p)a?u(null):l();else{let e=a?0:r,t=e*4,i=m.clippingState||null;c.value=i,i=u(d,o,t,s);for(let e=0;e!==t;++e)i[e]=n[e];m.clippingState=i,this.numIntersection=f?this.numPlanes:0,this.numPlanes+=e}};function l(){c.value!==n&&(c.value=n,c.needsUpdate=r>0),t.numPlanes=r,t.numIntersection=0}function u(e,n,r,i){let a=e===null?0:e.length,l=null;if(a!==0){if(l=c.value,i!==!0||l===null){let t=r+a*4,i=n.matrixWorldInverse;s.getNormalMatrix(i),(l===null||l.length<t)&&(l=new Float32Array(t));for(let t=0,n=r;t!==a;++t,n+=4)o.copy(e[t]).applyMatrix4(i,s),o.normal.toArray(l,n),l[n+3]=o.constant}c.value=l,c.needsUpdate=!0}return t.numPlanes=a,t.numIntersection=0,l}}var Vn=4,Hn=6,Un=20,Wn=256,Gn=new Wt,Kn=new Y,qn=null,Jn=0,Yn=0,Xn=!1,Zn=new Z,Qn=new Z,$n=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,t=0,n=.1,r=100,i={}){let{size:a=256,position:o=Zn}=i;qn=this._renderer.getRenderTarget(),Jn=this._renderer.getActiveCubeFace(),Yn=this._renderer.getActiveMipmapLevel(),Xn=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);let s=this._allocateTargets();return s.depthBuffer=!0,this._sceneToCubeUV(e,n,r,s,o),t>0&&this._blur(s,0,0,t),this._applyPMREM(s),this._cleanup(s),s}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=or(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=ar(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=2**this._lodMax}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(qn,Jn,Yn),this._renderer.xr.enabled=Xn,e.scissorTest=!1,nr(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===301||e.mapping===302?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),qn=this._renderer.getRenderTarget(),Jn=this._renderer.getActiveCubeFace(),Yn=this._renderer.getActiveMipmapLevel(),Xn=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:cn,minFilter:cn,generateMipmaps:!1,type:Ze,format:Dt,colorSpace:He,depthBuffer:!1},r=tr(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=tr(e,t,n);let{_lodMax:r}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods}=er(r)),this._blurMaterial=ir(r,e,t),this._ggxMaterial=rr(r,e,t)}return r}_compileMaterial(e){let t=new q(new _t,e);this._renderer.compile(t,Gn)}_sceneToCubeUV(e,t,n,r,i){let a=new Xt(90,1,t,n),o=[1,-1,1,1,1,1],s=[1,1,1,-1,-1,-1],c=this._renderer,l=c.autoClear,u=c.toneMapping;c.getClearColor(Kn),c.toneMapping=0,c.autoClear=!1,c.state.buffers.depth.getReversed()&&(c.setRenderTarget(r),c.clearDepth(),c.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new q(new Yt,new We({name:`PMREM.Background`,side:1,depthWrite:!1,depthTest:!1})));let d=this._backgroundBox,f=d.material,p=!1,m=e.background;m?m.isColor&&(f.color.copy(m),e.background=null,p=!0):(f.color.copy(Kn),p=!0);for(let t=0;t<6;t++){let n=t%3;n===0?(a.up.set(0,o[t],0),a.position.set(i.x,i.y,i.z),a.lookAt(i.x+s[t],i.y,i.z)):n===1?(a.up.set(0,0,o[t]),a.position.set(i.x,i.y,i.z),a.lookAt(i.x,i.y+s[t],i.z)):(a.up.set(0,o[t],0),a.position.set(i.x,i.y,i.z),a.lookAt(i.x,i.y,i.z+s[t]));let l=this._cubeSize;nr(r,n*l,t>2?l:0,l,l),c.setRenderTarget(r),p&&c.render(d,a),c.render(e,a)}c.toneMapping=u,c.autoClear=l,e.background=m}_textureToCubeUV(e,t){let n=this._renderer,r=e.mapping===301||e.mapping===302;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=or()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=ar());let i=r?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=i;let o=i.uniforms;o.envMap.value=e;let s=this._cubeSize;nr(t,0,0,3*s,2*s),n.setRenderTarget(t),n.render(a,Gn)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let r=this._lodMeshes.length;for(let t=1;t<r;t++)this._applyGGXFilter(e,t-1,t);t.autoClear=n}_applyGGXFilter(e,t,n){let r=this._renderer,i=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[n];o.material=a;let s=a.uniforms,c=n/(this._lodMeshes.length-1),l=t/(this._lodMeshes.length-1),u=Math.sqrt(c*c-l*l)*(c*1.25),{_lodMax:d}=this,f=this._sizeLods[n],p=3*f*(n>d-Vn?n-d+Vn:0),m=4*(this._cubeSize-f);s.envMap.value=e.texture,s.roughness.value=u,s.mipInt.value=d-t,nr(i,p,m,3*f,2*f),r.setRenderTarget(i),r.render(o,Gn),s.envMap.value=i.texture,s.roughness.value=0,s.mipInt.value=d-n,nr(e,p,m,3*f,2*f),r.setRenderTarget(e),r.render(o,Gn)}_blur(e,t,n,r){let i=this._pingPongRenderTarget,a=Math.min(r,Math.PI)/Math.SQRT2;this._blurPass(e,i,t,n,a),this._blurPass(i,e,n,n,a)}_blurPass(e,t,n,r,i){let a=this._renderer,o=this._blurMaterial,s=this._lodMeshes[r];s.material=o;let c=o.uniforms;c.envMap.value=e.texture,c.sigma.value=i,c.mipInt.value=this._lodMax-n;let l=this._sizeLods[r];nr(t,3*l*(r>this._lodMax-Vn?r-this._lodMax+Vn:0),4*(this._cubeSize-l),3*l,2*l),a.setRenderTarget(t),a.render(s,Gn)}};function er(e){let t=[],n=[],r=e,i=e-Vn+1+Hn;for(let e=0;e<i;e++){let e=2**r;t.push(e);let i=1/(e-2),a=-i,o=1+i,s=[a,a,o,a,o,o,a,a,o,o,a,o],c=new Float32Array(108),l=new Float32Array(108);for(let e=0;e<6;e++){let t=e%3*2/3-1,n=e>2?0:-1,r=[t,n,0,t+2/3,n,0,t+2/3,n+1,0,t,n,0,t+2/3,n+1,0,t,n+1,0];c.set(r,18*e);for(let t=0;t<6;t++){let n=s[t*2]*2-1,r=s[t*2+1]*2-1;e===0?Qn.set(1,r,n):e===1?Qn.set(-n,1,-r):e===2?Qn.set(-n,r,1):e===3?Qn.set(-1,r,-n):e===4?Qn.set(-n,-1,r):Qn.set(n,r,-1),Qn.toArray(l,(e*6+t)*3)}}let u=new _t;u.setAttribute(`position`,new Mt(c,3)),u.setAttribute(`outputDirection`,new Mt(l,3)),n.push(new q(u,null)),r>Vn&&r--}return{lodMeshes:n,sizeLods:t}}function tr(e,t,n){let r=new it(e,t,n);return r.texture.mapping=306,r.texture.name=`PMREM.cubeUv`,r.scissorTest=!0,r}function nr(e,t,n,r,i){e.viewport.set(t,n,r,i),e.scissor.set(t,n,r,i)}function rr(e,t,n){return new J({name:`PMREMGGXConvolution`,defines:{GGX_SAMPLES:Wn,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:sr(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function ir(e,t,n){return new J({name:`SphericalGaussianBlur`,defines:{SAMPLES:Un,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},sigma:{value:0},mipInt:{value:0}},vertexShader:sr(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float sigma;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359
			#define GOLDEN_ANGLE 2.39996322973

			void main() {

				if ( sigma == 0.0 ) {

					gl_FragColor = vec4( bilinearCubeUV( envMap, vOutputDirection, mipInt ), 1.0 );
					return;

				}

				vec3 outputDirection = normalize( vOutputDirection );

				vec3 up = abs( outputDirection.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
				vec3 tangent = normalize( cross( up, outputDirection ) );
				vec3 bitangent = cross( outputDirection, tangent );

				// Truncate the kernel at three standard deviations or at the antipode.
				float thetaMax = min( 3.0 * sigma, PI );
				float truncation = 1.0 - exp( - 0.5 * thetaMax * thetaMax / ( sigma * sigma ) );

				vec3 accumColor = vec3( 0.0 );
				float accumWeight = 0.0;

				for ( int i = 0; i < SAMPLES; i ++ ) {

					// Stratified inverse-CDF sampling of the Gaussian, placed on a golden-angle spiral.
					float stratum = ( float( i ) + 0.5 ) / float( SAMPLES );
					float theta = sigma * sqrt( - 2.0 * log( 1.0 - stratum * truncation ) );
					float phi = float( i ) * GOLDEN_ANGLE;

					vec3 offset = cos( phi ) * tangent + sin( phi ) * bitangent;
					vec3 sampleDirection = cos( theta ) * outputDirection + sin( theta ) * offset;

					// Correct the planar sample density to solid angle.
					float weight = sin( theta ) / theta;

					accumColor += weight * bilinearCubeUV( envMap, sampleDirection, mipInt );
					accumWeight += weight;

				}

				gl_FragColor = vec4( accumColor / accumWeight, 1.0 );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function ar(){return new J({name:`EquirectangularToCubeUV`,uniforms:{envMap:{value:null}},vertexShader:sr(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function or(){return new J({name:`CubemapToCubeUV`,uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:sr(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function sr(){return`

		precision mediump float;
		precision mediump int;

		attribute vec3 outputDirection;

		varying vec3 vOutputDirection;

		void main() {

			vOutputDirection = outputDirection;
			gl_Position = vec4( position, 1.0 );

		}
	`}var cr=class extends it{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},r=[n,n,n,n,n,n];this.texture=new ht(r),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},r=new Yt(5,5,5),i=new J({name:`CubemapFromEquirect`,uniforms:rn(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:1,blending:0});i.uniforms.tEquirect.value=t;let a=new q(r,i),o=t.minFilter;return t.minFilter===1008&&(t.minFilter=cn),new At(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,r=!0){let i=e.getRenderTarget();for(let i=0;i<6;i++)e.setRenderTarget(this,i),e.clear(t,n,r);e.setRenderTarget(i)}};function lr(e){let t=new WeakMap,n=new WeakMap,r=null;function i(e,t=!1){return e==null?null:t?o(e):a(e)}function a(n){if(n&&n.isTexture){let r=n.mapping;if(r===303||r===304){if(t.has(n)){let e=t.get(n).texture;return s(e,n.mapping)}{let r=n.image;if(r&&r.height>0){let i=new cr(r.height);return i.fromEquirectangularTexture(e,n),t.set(n,i),n.addEventListener(`dispose`,l),s(i.texture,n.mapping)}return null}}}return n}function o(t){if(t&&t.isTexture){let i=t.mapping,a=i===303||i===304,o=i===301||i===302;if(a||o){let i=n.get(t),s=i===void 0?0:i.texture.pmremVersion;if(t.isRenderTargetTexture&&t.pmremVersion!==s)return r===null&&(r=new $n(e)),i=a?r.fromEquirectangular(t,i):r.fromCubemap(t,i),i.texture.pmremVersion=t.pmremVersion,n.set(t,i),i.texture;if(i!==void 0)return i.texture;{let s=t.image;return a&&s&&s.height>0||o&&s&&c(s)?(r===null&&(r=new $n(e)),i=a?r.fromEquirectangular(t):r.fromCubemap(t),i.texture.pmremVersion=t.pmremVersion,n.set(t,i),t.addEventListener(`dispose`,u),i.texture):null}}}return t}function s(e,t){return t===303?e.mapping=301:t===304&&(e.mapping=302),e}function c(e){let t=0;for(let n=0;n<6;n++)e[n]!==void 0&&t++;return t===6}function l(e){let n=e.target;n.removeEventListener(`dispose`,l);let r=t.get(n);r!==void 0&&(t.delete(n),r.dispose())}function u(e){let t=e.target;t.removeEventListener(`dispose`,u);let r=n.get(t);r!==void 0&&(n.delete(t),r.dispose())}function d(){t=new WeakMap,n=new WeakMap,r!==null&&(r.dispose(),r=null)}return{get:i,dispose:d}}function ur(e){let t={};function n(n){if(t[n]!==void 0)return t[n];let r=e.getExtension(n);return t[n]=r,r}return{has:function(e){return n(e)!==null},init:function(){n(`EXT_color_buffer_float`),n(`WEBGL_clip_cull_distance`),n(`OES_texture_float_linear`),n(`EXT_color_buffer_half_float`),n(`WEBGL_multisampled_render_to_texture`),n(`WEBGL_render_shared_exponent`)},get:function(e){let t=n(e);return t===null&&et(`WebGLRenderer: `+e+` extension not supported.`),t}}}function dr(e,t,n,r){let i={},a=new WeakMap;function o(e){let s=e.target;s.index!==null&&t.remove(s.index);for(let e in s.attributes)t.remove(s.attributes[e]);s.removeEventListener(`dispose`,o),delete i[s.id];let c=a.get(s);c&&(t.remove(c),a.delete(s)),r.releaseStatesOfGeometry(s),s.isInstancedBufferGeometry===!0&&delete s._maxInstanceCount,n.memory.geometries--}function s(e,t){return i[t.id]===!0?t:(t.addEventListener(`dispose`,o),i[t.id]=!0,n.memory.geometries++,t)}function c(n){let r=n.attributes;for(let n in r)t.update(r[n],e.ARRAY_BUFFER)}function l(e){let n=[],r=e.index,i=e.attributes.position,o=0;if(i===void 0)return;if(r!==null){let e=r.array;o=r.version;for(let t=0,r=e.length;t<r;t+=3){let r=e[t+0],i=e[t+1],a=e[t+2];n.push(r,i,i,a,a,r)}}else{let e=i.array;o=i.version;for(let t=0,r=e.length/3-1;t<r;t+=3){let e=t+0,r=t+1,i=t+2;n.push(e,r,r,i,i,e)}}let s=new(i.count>=65535?xt:Qt)(n,1);s.version=o;let c=a.get(e);c&&t.remove(c),a.set(e,s)}function u(e){let t=a.get(e);if(t){let n=e.index;n!==null&&t.version<n.version&&l(e)}else l(e);return a.get(e)}return{get:s,update:c,getWireframeAttribute:u}}function fr(e,t,n){let r;function i(e){r=e}let a,o;function s(e){a=e.type,o=e.bytesPerElement}function c(t,i){e.drawElements(r,i,a,t*o),n.update(i,r,1)}function l(t,i,s){s!==0&&(e.drawElementsInstanced(r,i,a,t*o,s),n.update(i,r,s))}function u(e,i,o){if(o===0)return;t.get(`WEBGL_multi_draw`).multiDrawElementsWEBGL(r,i,0,a,e,0,o);let s=0;for(let e=0;e<o;e++)s+=i[e];n.update(s,r,1)}this.setMode=i,this.setIndex=s,this.render=c,this.renderInstances=l,this.renderMultiDraw=u}function pr(e){let t={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function r(t,r,i){switch(n.calls++,r){case e.TRIANGLES:n.triangles+=t/3*i;break;case e.LINES:n.lines+=t/2*i;break;case e.LINE_STRIP:n.lines+=i*(t-1);break;case e.LINE_LOOP:n.lines+=i*t;break;case e.POINTS:n.points+=i*t;break;default:U(`WebGLInfo: Unknown draw mode:`,r)}}function i(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:t,render:n,programs:null,autoReset:!0,reset:i,update:r}}function mr(e,t,n){let r=new WeakMap,i=new K;function a(a,o,s){let c=a.morphTargetInfluences,l=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=l===void 0?0:l.length,d=r.get(o);if(d===void 0||d.count!==u){d!==void 0&&d.texture.dispose();let e=o.morphAttributes.position!==void 0,n=o.morphAttributes.normal!==void 0,a=o.morphAttributes.color!==void 0,s=o.morphAttributes.position||[],c=o.morphAttributes.normal||[],l=o.morphAttributes.color||[],f=0;e===!0&&(f=1),n===!0&&(f=2),a===!0&&(f=3);let p=o.attributes.position.count*f,m=1;p>t.maxTextureSize&&(m=Math.ceil(p/t.maxTextureSize),p=t.maxTextureSize);let h=new Float32Array(p*m*4*u),g=new sn(h,p,m,u);g.type=Qe,g.needsUpdate=!0;let _=f*4;for(let t=0;t<u;t++){let r=s[t],o=c[t],u=l[t],d=p*m*4*t;for(let t=0;t<r.count;t++){let s=t*_;e===!0&&(i.fromBufferAttribute(r,t),h[d+s+0]=i.x,h[d+s+1]=i.y,h[d+s+2]=i.z,h[d+s+3]=0),n===!0&&(i.fromBufferAttribute(o,t),h[d+s+4]=i.x,h[d+s+5]=i.y,h[d+s+6]=i.z,h[d+s+7]=0),a===!0&&(i.fromBufferAttribute(u,t),h[d+s+8]=i.x,h[d+s+9]=i.y,h[d+s+10]=i.z,h[d+s+11]=u.itemSize===4?i.w:1)}}d={count:u,texture:g,size:new X(p,m)},r.set(o,d);function v(){g.dispose(),r.delete(o),o.removeEventListener(`dispose`,v)}o.addEventListener(`dispose`,v)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)s.getUniforms().setValue(e,`morphTexture`,a.morphTexture,n);else{let t=0;for(let e=0;e<c.length;e++)t+=c[e];let n=o.morphTargetsRelative?1:1-t;s.getUniforms().setValue(e,`morphTargetBaseInfluence`,n),s.getUniforms().setValue(e,`morphTargetInfluences`,c)}s.getUniforms().setValue(e,`morphTargetsTexture`,d.texture,n),s.getUniforms().setValue(e,`morphTargetsTextureSize`,d.size)}return{update:a}}function hr(e,t,n,r,i){let a=new WeakMap;function o(r){let o=i.render.frame,s=r.geometry,l=t.get(r,s);if(a.get(l)!==o&&(t.update(l),a.set(l,o)),r.isInstancedMesh&&(r.hasEventListener(`dispose`,c)===!1&&r.addEventListener(`dispose`,c),a.get(r)!==o&&(n.update(r.instanceMatrix,e.ARRAY_BUFFER),r.instanceColor!==null&&n.update(r.instanceColor,e.ARRAY_BUFFER),a.set(r,o))),r.isSkinnedMesh){let e=r.skeleton;a.get(e)!==o&&(e.update(),a.set(e,o))}return l}function s(){a=new WeakMap}function c(e){let t=e.target;t.removeEventListener(`dispose`,c),r.releaseStatesOfObject(t),n.remove(t.instanceMatrix),t.instanceColor!==null&&n.remove(t.instanceColor)}return{update:o,dispose:s}}var gr={1:`LINEAR_TONE_MAPPING`,2:`REINHARD_TONE_MAPPING`,3:`CINEON_TONE_MAPPING`,4:`ACES_FILMIC_TONE_MAPPING`,6:`AGX_TONE_MAPPING`,7:`NEUTRAL_TONE_MAPPING`,5:`CUSTOM_TONE_MAPPING`};function _r(e,t,n,r,i,a){let o=new it(t,n,{type:e,depthBuffer:i,stencilBuffer:a,samples:r?4:0,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,resolveDepthBuffer:!1,resolveStencilBuffer:!1}),s=null,c=null,l=new _t;l.setAttribute(`position`,new Re([-1,3,0,-1,-1,0,3,-1,0],3)),l.setAttribute(`uv`,new Re([0,2,0,0,2,0],2));let u=new Ve({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),d=new q(l,u),f=new Wt(-1,1,1,-1,0,1),p=null,m=null,h=!1,g,_=null,v=[],y=!1;this.setSize=function(e,t){o.setSize(e,t),s!==null&&s.setSize(e,t),c!==null&&c.setSize(e,t);for(let n=0;n<v.length;n++){let r=v[n];r.setSize&&r.setSize(e,t)}},this.setEffects=function(e){v=e,y=v.length>0&&v[0].isRenderPass===!0;let t=o.width,n=o.height;v.length>0&&s===null&&(s=new it(t,n,{type:Ze,depthBuffer:!1,stencilBuffer:!1}),c=new it(t,n,{type:Ze,depthBuffer:!1,stencilBuffer:!1}));for(let e=0;e<v.length;e++){let r=v[e];r.setSize&&r.setSize(t,n)}},this.begin=function(e,t){if(h||e.toneMapping===0&&v.length===0)return!1;if(_=t,t!==null){let e=t.width,n=t.height;(o.width!==e||o.height!==n)&&this.setSize(e,n)}return y===!1&&e.setRenderTarget(o),g=e.toneMapping,e.toneMapping=0,!0},this.hasRenderPass=function(){return y},this.end=function(e,t){e.toneMapping=g,h=!0;let n=o,r=s;for(let i=0;i<v.length;i++){let a=v[i];a.enabled!==!1&&(a.render(e,r,n,t),a.needsSwap!==!1&&(n=r,r=r===s?c:s))}if(p!==e.outputColorSpace||m!==e.toneMapping){p=e.outputColorSpace,m=e.toneMapping,u.defines={},Ct.getTransfer(p)===`srgb`&&(u.defines.SRGB_TRANSFER=``);let t=gr[m];t&&(u.defines[t]=``),u.needsUpdate=!0}u.uniforms.tDiffuse.value=n.texture,e.setRenderTarget(_),e.render(d,f),_=null,h=!1},this.isCompositing=function(){return h},this.dispose=function(){o.dispose(),s!==null&&s.dispose(),c!==null&&c.dispose(),l.dispose(),u.dispose()}}var vr=new Gt,yr=new Ie(1,1),br=new sn,xr=new tn,Sr=new ht,Cr=[],wr=[],Tr=new Float32Array(16),Er=new Float32Array(9),Dr=new Float32Array(4);function Or(e,t,n){let r=e[0];if(r<=0||r>0)return e;let i=t*n,a=Cr[i];if(a===void 0&&(a=new Float32Array(i),Cr[i]=a),t!==0){r.toArray(a,0);for(let r=1,i=0;r!==t;++r)i+=n,e[r].toArray(a,i)}return a}function kr(e,t){if(e.length!==t.length)return!1;for(let n=0,r=e.length;n<r;n++)if(e[n]!==t[n])return!1;return!0}function Ar(e,t){for(let n=0,r=t.length;n<r;n++)e[n]=t[n]}function jr(e,t){let n=wr[t];n===void 0&&(n=new Int32Array(t),wr[t]=n);for(let r=0;r!==t;++r)n[r]=e.allocateTextureUnit();return n}function Mr(e,t){let n=this.cache;n[0]!==t&&(e.uniform1f(this.addr,t),n[0]=t)}function Nr(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2f(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(kr(n,t))return;e.uniform2fv(this.addr,t),Ar(n,t)}}function Pr(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3f(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else if(t.r!==void 0)(n[0]!==t.r||n[1]!==t.g||n[2]!==t.b)&&(e.uniform3f(this.addr,t.r,t.g,t.b),n[0]=t.r,n[1]=t.g,n[2]=t.b);else{if(kr(n,t))return;e.uniform3fv(this.addr,t),Ar(n,t)}}function Fr(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4f(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(kr(n,t))return;e.uniform4fv(this.addr,t),Ar(n,t)}}function Ir(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(kr(n,t))return;e.uniformMatrix2fv(this.addr,!1,t),Ar(n,t)}else{if(kr(n,r))return;Dr.set(r),e.uniformMatrix2fv(this.addr,!1,Dr),Ar(n,r)}}function Lr(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(kr(n,t))return;e.uniformMatrix3fv(this.addr,!1,t),Ar(n,t)}else{if(kr(n,r))return;Er.set(r),e.uniformMatrix3fv(this.addr,!1,Er),Ar(n,r)}}function Rr(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(kr(n,t))return;e.uniformMatrix4fv(this.addr,!1,t),Ar(n,t)}else{if(kr(n,r))return;Tr.set(r),e.uniformMatrix4fv(this.addr,!1,Tr),Ar(n,r)}}function zr(e,t){let n=this.cache;n[0]!==t&&(e.uniform1i(this.addr,t),n[0]=t)}function Br(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2i(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(kr(n,t))return;e.uniform2iv(this.addr,t),Ar(n,t)}}function Vr(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3i(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if(kr(n,t))return;e.uniform3iv(this.addr,t),Ar(n,t)}}function Hr(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4i(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(kr(n,t))return;e.uniform4iv(this.addr,t),Ar(n,t)}}function Ur(e,t){let n=this.cache;n[0]!==t&&(e.uniform1ui(this.addr,t),n[0]=t)}function Wr(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2ui(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(kr(n,t))return;e.uniform2uiv(this.addr,t),Ar(n,t)}}function Gr(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3ui(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if(kr(n,t))return;e.uniform3uiv(this.addr,t),Ar(n,t)}}function Kr(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4ui(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(kr(n,t))return;e.uniform4uiv(this.addr,t),Ar(n,t)}}function qr(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i);let a;this.type===e.SAMPLER_2D_SHADOW?(yr.compareFunction=n.isReversedDepthBuffer()?518:515,a=yr):a=vr,n.setTexture2D(t||a,i)}function Jr(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTexture3D(t||xr,i)}function Yr(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTextureCube(t||Sr,i)}function Xr(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTexture2DArray(t||br,i)}function Zr(e){switch(e){case 5126:return Mr;case 35664:return Nr;case 35665:return Pr;case 35666:return Fr;case 35674:return Ir;case 35675:return Lr;case 35676:return Rr;case 5124:case 35670:return zr;case 35667:case 35671:return Br;case 35668:case 35672:return Vr;case 35669:case 35673:return Hr;case 5125:return Ur;case 36294:return Wr;case 36295:return Gr;case 36296:return Kr;case 35678:case 36198:case 36298:case 36306:case 35682:return qr;case 35679:case 36299:case 36307:return Jr;case 35680:case 36300:case 36308:case 36293:return Yr;case 36289:case 36303:case 36311:case 36292:return Xr}}function Qr(e,t){e.uniform1fv(this.addr,t)}function $r(e,t){let n=Or(t,this.size,2);e.uniform2fv(this.addr,n)}function ei(e,t){let n=Or(t,this.size,3);e.uniform3fv(this.addr,n)}function ti(e,t){let n=Or(t,this.size,4);e.uniform4fv(this.addr,n)}function ni(e,t){let n=Or(t,this.size,4);e.uniformMatrix2fv(this.addr,!1,n)}function ri(e,t){let n=Or(t,this.size,9);e.uniformMatrix3fv(this.addr,!1,n)}function ii(e,t){let n=Or(t,this.size,16);e.uniformMatrix4fv(this.addr,!1,n)}function ai(e,t){e.uniform1iv(this.addr,t)}function oi(e,t){e.uniform2iv(this.addr,t)}function si(e,t){e.uniform3iv(this.addr,t)}function ci(e,t){e.uniform4iv(this.addr,t)}function li(e,t){e.uniform1uiv(this.addr,t)}function ui(e,t){e.uniform2uiv(this.addr,t)}function di(e,t){e.uniform3uiv(this.addr,t)}function fi(e,t){e.uniform4uiv(this.addr,t)}function pi(e,t,n){let r=this.cache,i=t.length,a=jr(n,i);kr(r,a)||(e.uniform1iv(this.addr,a),Ar(r,a));let o;o=this.type===e.SAMPLER_2D_SHADOW?yr:vr;for(let e=0;e!==i;++e)n.setTexture2D(t[e]||o,a[e])}function mi(e,t,n){let r=this.cache,i=t.length,a=jr(n,i);kr(r,a)||(e.uniform1iv(this.addr,a),Ar(r,a));for(let e=0;e!==i;++e)n.setTexture3D(t[e]||xr,a[e])}function hi(e,t,n){let r=this.cache,i=t.length,a=jr(n,i);kr(r,a)||(e.uniform1iv(this.addr,a),Ar(r,a));for(let e=0;e!==i;++e)n.setTextureCube(t[e]||Sr,a[e])}function gi(e,t,n){let r=this.cache,i=t.length,a=jr(n,i);kr(r,a)||(e.uniform1iv(this.addr,a),Ar(r,a));for(let e=0;e!==i;++e)n.setTexture2DArray(t[e]||br,a[e])}function _i(e){switch(e){case 5126:return Qr;case 35664:return $r;case 35665:return ei;case 35666:return ti;case 35674:return ni;case 35675:return ri;case 35676:return ii;case 5124:case 35670:return ai;case 35667:case 35671:return oi;case 35668:case 35672:return si;case 35669:case 35673:return ci;case 5125:return li;case 36294:return ui;case 36295:return di;case 36296:return fi;case 35678:case 36198:case 36298:case 36306:case 35682:return pi;case 35679:case 36299:case 36307:return mi;case 35680:case 36300:case 36308:case 36293:return hi;case 36289:case 36303:case 36311:case 36292:return gi}}var vi=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=Zr(t.type)}},yi=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=_i(t.type)}},bi=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let r=this.seq;for(let i=0,a=r.length;i!==a;++i){let a=r[i];a.setValue(e,t[a.id],n)}}},xi=/(\w+)(\])?(\[|\.)?/g;function Si(e,t){e.seq.push(t),e.map[t.id]=t}function Ci(e,t,n){let r=e.name,i=r.length;for(xi.lastIndex=0;;){let a=xi.exec(r),o=xi.lastIndex,s=a[1],c=a[2]===`]`,l=a[3];if(c&&(s|=0),l===void 0||l===`[`&&o+2===i){Si(n,l===void 0?new vi(s,e,t):new yi(s,e,t));break}{let e=n.map[s];e===void 0&&(e=new bi(s),Si(n,e)),n=e}}}var wi=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let r=0;r<n;++r){let n=e.getActiveUniform(t,r);Ci(n,e.getUniformLocation(t,n.name),this)}let r=[],i=[];for(let t of this.seq)t.type===e.SAMPLER_2D_SHADOW||t.type===e.SAMPLER_CUBE_SHADOW||t.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(t):i.push(t);r.length>0&&(this.seq=r.concat(i))}setValue(e,t,n,r){let i=this.map[t];i!==void 0&&i.setValue(e,n,r)}setOptional(e,t,n){let r=t[n];r!==void 0&&this.setValue(e,n,r)}static upload(e,t,n,r){for(let i=0,a=t.length;i!==a;++i){let a=t[i],o=n[a.id];o.needsUpdate!==!1&&a.setValue(e,o.value,r)}}static seqWithValue(e,t){let n=[];for(let r=0,i=e.length;r!==i;++r){let i=e[r];i.id in t&&n.push(i)}return n}};function Ti(e,t,n){let r=e.createShader(t);return e.shaderSource(r,n),e.compileShader(r),r}var Ei=37297,Di=0;function Oi(e,t){let n=e.split(`
`),r=[],i=Math.max(t-6,0),a=Math.min(t+6,n.length);for(let e=i;e<a;e++){let i=e+1;r.push(`${i===t?`>`:` `} ${i}: ${n[e]}`)}return r.join(`
`)}var ki=new W;function Ai(e){Ct._getMatrix(ki,Ct.workingColorSpace,e);let t=`mat3( ${ki.elements.map(e=>e.toFixed(4))} )`;switch(Ct.getTransfer(e)){case st:return[t,`LinearTransferOETF`];case $t:return[t,`sRGBTransferOETF`];default:return G(`WebGLProgram: Unsupported color space: `,e),[t,`LinearTransferOETF`]}}function ji(e,t,n){let r=e.getShaderParameter(t,e.COMPILE_STATUS),i=(e.getShaderInfoLog(t)||``).trim();if(r&&i===``)return``;let a=/ERROR: 0:(\d+)/.exec(i);if(a){let r=parseInt(a[1]);return n.toUpperCase()+`

`+i+`

`+Oi(e.getShaderSource(t),r)}return i}function Mi(e,t){let n=Ai(t);return[`vec4 ${e}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,`}`].join(`
`)}var Ni={1:`Linear`,2:`Reinhard`,3:`Cineon`,4:`ACESFilmic`,6:`AgX`,7:`Neutral`,5:`Custom`};function Pi(e,t){let n=Ni[t];return n===void 0?(G(`WebGLProgram: Unsupported toneMapping:`,t),`vec3 `+e+`( vec3 color ) { return LinearToneMapping( color ); }`):`vec3 `+e+`( vec3 color ) { return `+n+`ToneMapping( color ); }`}var Fi=new Z;function Ii(){return Ct.getLuminanceCoefficients(Fi),[`float luminance( const in vec3 rgb ) {`,`	const vec3 weights = vec3( ${Fi.x.toFixed(4)}, ${Fi.y.toFixed(4)}, ${Fi.z.toFixed(4)} );`,`	return dot( weights, rgb );`,`}`].join(`
`)}function Li(e){return[e.extensionClipCullDistance?`#extension GL_ANGLE_clip_cull_distance : require`:``,e.extensionMultiDraw?`#extension GL_ANGLE_multi_draw : require`:``].filter(Bi).join(`
`)}function Ri(e){let t=[];for(let n in e){let r=e[n];r!==!1&&t.push(`#define `+n+` `+r)}return t.join(`
`)}function zi(e,t){let n={},r=e.getProgramParameter(t,e.ACTIVE_ATTRIBUTES);for(let i=0;i<r;i++){let r=e.getActiveAttrib(t,i),a=r.name,o=1;r.type===e.FLOAT_MAT2&&(o=2),r.type===e.FLOAT_MAT3&&(o=3),r.type===e.FLOAT_MAT4&&(o=4),n[a]={type:r.type,location:e.getAttribLocation(t,a),locationSize:o}}return n}function Bi(e){return e!==``}function Vi(e,t){let n=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return e.replace(/NUM_SUN_LIGHTS/g,t.numSunLights).replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g,t.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function Hi(e,t){return e.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}var Ui=/^[ \t]*#include +<([\w\d./]+)>/gm;function Wi(e){return e.replace(Ui,Ki)}var Gi=new Map;function Ki(e,t){let n=Q[t];if(n===void 0){let e=Gi.get(t);if(e!==void 0)n=Q[e],G(`WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.`,t,e);else throw Error(`THREE.WebGLProgram: Can not resolve #include <`+t+`>`)}return Wi(n)}var qi=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Ji(e){return e.replace(qi,Yi)}function Yi(e,t,n,r){let i=``;for(let e=parseInt(t);e<parseInt(n);e++)i+=r.replace(/\[\s*i\s*\]/g,`[ `+e+` ]`).replace(/UNROLLED_LOOP_INDEX/g,e);return i}function Xi(e){let t=`precision ${e.precision} float;
	precision ${e.precision} int;
	precision ${e.precision} sampler2D;
	precision ${e.precision} samplerCube;
	precision ${e.precision} sampler3D;
	precision ${e.precision} sampler2DArray;
	precision ${e.precision} sampler2DShadow;
	precision ${e.precision} samplerCubeShadow;
	precision ${e.precision} sampler2DArrayShadow;
	precision ${e.precision} isampler2D;
	precision ${e.precision} isampler3D;
	precision ${e.precision} isamplerCube;
	precision ${e.precision} isampler2DArray;
	precision ${e.precision} usampler2D;
	precision ${e.precision} usampler3D;
	precision ${e.precision} usamplerCube;
	precision ${e.precision} usampler2DArray;
	`;return e.precision===`highp`?t+=`
#define HIGH_PRECISION`:e.precision===`mediump`?t+=`
#define MEDIUM_PRECISION`:e.precision===`lowp`&&(t+=`
#define LOW_PRECISION`),t}var Zi={1:`SHADOWMAP_TYPE_PCF`,3:`SHADOWMAP_TYPE_VSM`};function Qi(e){return Zi[e.shadowMapType]||`SHADOWMAP_TYPE_BASIC`}var $i={301:`ENVMAP_TYPE_CUBE`,302:`ENVMAP_TYPE_CUBE`,306:`ENVMAP_TYPE_CUBE_UV`};function ea(e){return e.envMap===!1?`ENVMAP_TYPE_CUBE`:$i[e.envMapMode]||`ENVMAP_TYPE_CUBE`}var ta={302:`ENVMAP_MODE_REFRACTION`};function na(e){return e.envMap===!1?`ENVMAP_MODE_REFLECTION`:ta[e.envMapMode]||`ENVMAP_MODE_REFLECTION`}var ra={0:`ENVMAP_BLENDING_MULTIPLY`,1:`ENVMAP_BLENDING_MIX`,2:`ENVMAP_BLENDING_ADD`};function ia(e){return e.envMap===!1?`ENVMAP_BLENDING_NONE`:ra[e.combine]||`ENVMAP_BLENDING_NONE`}function aa(e){let t=e.envMapCubeUVHeight;if(t===null)return null;let n=Math.log2(t)-2,r=1/t;return{texelWidth:1/(3*Math.max(2**n,112)),texelHeight:r,maxMip:n}}function oa(e,t,n,r){let i=e.getContext(),a=n.defines,o=n.vertexShader,s=n.fragmentShader,c=Qi(n),l=ea(n),u=na(n),d=ia(n),f=aa(n),p=Li(n),m=Ri(a),h=i.createProgram(),g,_,v=n.glslVersion?`#version `+n.glslVersion+`
`:``;n.isRawShaderMaterial?(g=[`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m].filter(Bi).join(`
`),g.length>0&&(g+=`
`),_=[`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m].filter(Bi).join(`
`),_.length>0&&(_+=`
`)):(g=[Xi(n),`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m,n.extensionClipCullDistance?`#define USE_CLIP_DISTANCE`:``,n.batching?`#define USE_BATCHING`:``,n.batchingColor?`#define USE_BATCHING_COLOR`:``,n.instancing?`#define USE_INSTANCING`:``,n.instancingColor?`#define USE_INSTANCING_COLOR`:``,n.instancingMorph?`#define USE_INSTANCING_MORPH`:``,n.useFog&&n.fog?`#define USE_FOG`:``,n.useFog&&n.fogExp2?`#define FOG_EXP2`:``,n.map?`#define USE_MAP`:``,n.envMap?`#define USE_ENVMAP`:``,n.envMap?`#define `+u:``,n.lightMap?`#define USE_LIGHTMAP`:``,n.aoMap?`#define USE_AOMAP`:``,n.bumpMap?`#define USE_BUMPMAP`:``,n.normalMap?`#define USE_NORMALMAP`:``,n.normalMapObjectSpace?`#define USE_NORMALMAP_OBJECTSPACE`:``,n.normalMapTangentSpace?`#define USE_NORMALMAP_TANGENTSPACE`:``,n.displacementMap?`#define USE_DISPLACEMENTMAP`:``,n.emissiveMap?`#define USE_EMISSIVEMAP`:``,n.anisotropy?`#define USE_ANISOTROPY`:``,n.anisotropyMap?`#define USE_ANISOTROPYMAP`:``,n.clearcoatMap?`#define USE_CLEARCOATMAP`:``,n.clearcoatRoughnessMap?`#define USE_CLEARCOAT_ROUGHNESSMAP`:``,n.clearcoatNormalMap?`#define USE_CLEARCOAT_NORMALMAP`:``,n.iridescenceMap?`#define USE_IRIDESCENCEMAP`:``,n.iridescenceThicknessMap?`#define USE_IRIDESCENCE_THICKNESSMAP`:``,n.specularMap?`#define USE_SPECULARMAP`:``,n.specularColorMap?`#define USE_SPECULAR_COLORMAP`:``,n.specularIntensityMap?`#define USE_SPECULAR_INTENSITYMAP`:``,n.roughnessMap?`#define USE_ROUGHNESSMAP`:``,n.metalnessMap?`#define USE_METALNESSMAP`:``,n.alphaMap?`#define USE_ALPHAMAP`:``,n.alphaHash?`#define USE_ALPHAHASH`:``,n.transmission?`#define USE_TRANSMISSION`:``,n.transmissionMap?`#define USE_TRANSMISSIONMAP`:``,n.thicknessMap?`#define USE_THICKNESSMAP`:``,n.sheenColorMap?`#define USE_SHEEN_COLORMAP`:``,n.sheenRoughnessMap?`#define USE_SHEEN_ROUGHNESSMAP`:``,n.mapUv?`#define MAP_UV `+n.mapUv:``,n.alphaMapUv?`#define ALPHAMAP_UV `+n.alphaMapUv:``,n.lightMapUv?`#define LIGHTMAP_UV `+n.lightMapUv:``,n.aoMapUv?`#define AOMAP_UV `+n.aoMapUv:``,n.emissiveMapUv?`#define EMISSIVEMAP_UV `+n.emissiveMapUv:``,n.bumpMapUv?`#define BUMPMAP_UV `+n.bumpMapUv:``,n.normalMapUv?`#define NORMALMAP_UV `+n.normalMapUv:``,n.displacementMapUv?`#define DISPLACEMENTMAP_UV `+n.displacementMapUv:``,n.metalnessMapUv?`#define METALNESSMAP_UV `+n.metalnessMapUv:``,n.roughnessMapUv?`#define ROUGHNESSMAP_UV `+n.roughnessMapUv:``,n.anisotropyMapUv?`#define ANISOTROPYMAP_UV `+n.anisotropyMapUv:``,n.clearcoatMapUv?`#define CLEARCOATMAP_UV `+n.clearcoatMapUv:``,n.clearcoatNormalMapUv?`#define CLEARCOAT_NORMALMAP_UV `+n.clearcoatNormalMapUv:``,n.clearcoatRoughnessMapUv?`#define CLEARCOAT_ROUGHNESSMAP_UV `+n.clearcoatRoughnessMapUv:``,n.iridescenceMapUv?`#define IRIDESCENCEMAP_UV `+n.iridescenceMapUv:``,n.iridescenceThicknessMapUv?`#define IRIDESCENCE_THICKNESSMAP_UV `+n.iridescenceThicknessMapUv:``,n.sheenColorMapUv?`#define SHEEN_COLORMAP_UV `+n.sheenColorMapUv:``,n.sheenRoughnessMapUv?`#define SHEEN_ROUGHNESSMAP_UV `+n.sheenRoughnessMapUv:``,n.specularMapUv?`#define SPECULARMAP_UV `+n.specularMapUv:``,n.specularColorMapUv?`#define SPECULAR_COLORMAP_UV `+n.specularColorMapUv:``,n.specularIntensityMapUv?`#define SPECULAR_INTENSITYMAP_UV `+n.specularIntensityMapUv:``,n.transmissionMapUv?`#define TRANSMISSIONMAP_UV `+n.transmissionMapUv:``,n.thicknessMapUv?`#define THICKNESSMAP_UV `+n.thicknessMapUv:``,n.vertexTangents&&n.flatShading===!1?`#define USE_TANGENT`:``,n.vertexNormals?`#define HAS_NORMAL`:``,n.vertexColors?`#define USE_COLOR`:``,n.vertexAlphas?`#define USE_COLOR_ALPHA`:``,n.vertexUv1s?`#define USE_UV1`:``,n.vertexUv2s?`#define USE_UV2`:``,n.vertexUv3s?`#define USE_UV3`:``,n.pointsUvs?`#define USE_POINTS_UV`:``,n.flatShading?`#define FLAT_SHADED`:``,n.skinning?`#define USE_SKINNING`:``,n.morphTargets?`#define USE_MORPHTARGETS`:``,n.morphNormals&&n.flatShading===!1?`#define USE_MORPHNORMALS`:``,n.morphColors?`#define USE_MORPHCOLORS`:``,n.morphTargetsCount>0?`#define MORPHTARGETS_TEXTURE_STRIDE `+n.morphTextureStride:``,n.morphTargetsCount>0?`#define MORPHTARGETS_COUNT `+n.morphTargetsCount:``,n.doubleSided?`#define DOUBLE_SIDED`:``,n.flipSided?`#define FLIP_SIDED`:``,n.shadowMapEnabled?`#define USE_SHADOWMAP`:``,n.shadowMapEnabled?`#define `+c:``,n.sizeAttenuation?`#define USE_SIZEATTENUATION`:``,n.numLightProbes>0?`#define USE_LIGHT_PROBES`:``,n.logarithmicDepthBuffer?`#define USE_LOGARITHMIC_DEPTH_BUFFER`:``,n.reversedDepthBuffer?`#define USE_REVERSED_DEPTH_BUFFER`:``,`uniform mat4 modelMatrix;`,`uniform mat4 modelViewMatrix;`,`uniform mat4 projectionMatrix;`,`uniform mat4 viewMatrix;`,`uniform mat3 normalMatrix;`,`uniform vec3 cameraPosition;`,`uniform bool isOrthographic;`,`#ifdef USE_INSTANCING`,`	attribute mat4 instanceMatrix;`,`#endif`,`#ifdef USE_INSTANCING_COLOR`,`	attribute vec3 instanceColor;`,`#endif`,`#ifdef USE_INSTANCING_MORPH`,`	uniform sampler2D morphTexture;`,`#endif`,`attribute vec3 position;`,`attribute vec3 normal;`,`attribute vec2 uv;`,`#ifdef USE_UV1`,`	attribute vec2 uv1;`,`#endif`,`#ifdef USE_UV2`,`	attribute vec2 uv2;`,`#endif`,`#ifdef USE_UV3`,`	attribute vec2 uv3;`,`#endif`,`#ifdef USE_TANGENT`,`	attribute vec4 tangent;`,`#endif`,`#if defined( USE_COLOR_ALPHA )`,`	attribute vec4 color;`,`#elif defined( USE_COLOR )`,`	attribute vec3 color;`,`#endif`,`#ifdef USE_SKINNING`,`	attribute vec4 skinIndex;`,`	attribute vec4 skinWeight;`,`#endif`,`
`].filter(Bi).join(`
`),_=[Xi(n),`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m,n.useFog&&n.fog?`#define USE_FOG`:``,n.useFog&&n.fogExp2?`#define FOG_EXP2`:``,n.alphaToCoverage?`#define ALPHA_TO_COVERAGE`:``,n.map?`#define USE_MAP`:``,n.matcap?`#define USE_MATCAP`:``,n.envMap?`#define USE_ENVMAP`:``,n.envMap?`#define `+l:``,n.envMap?`#define `+u:``,n.envMap?`#define `+d:``,f?`#define CUBEUV_TEXEL_WIDTH `+f.texelWidth:``,f?`#define CUBEUV_TEXEL_HEIGHT `+f.texelHeight:``,f?`#define CUBEUV_MAX_MIP `+f.maxMip+`.0`:``,n.lightMap?`#define USE_LIGHTMAP`:``,n.aoMap?`#define USE_AOMAP`:``,n.bumpMap?`#define USE_BUMPMAP`:``,n.normalMap?`#define USE_NORMALMAP`:``,n.normalMapObjectSpace?`#define USE_NORMALMAP_OBJECTSPACE`:``,n.normalMapTangentSpace?`#define USE_NORMALMAP_TANGENTSPACE`:``,n.packedNormalMap?`#define USE_PACKED_NORMALMAP`:``,n.emissiveMap?`#define USE_EMISSIVEMAP`:``,n.anisotropy?`#define USE_ANISOTROPY`:``,n.anisotropyMap?`#define USE_ANISOTROPYMAP`:``,n.clearcoat?`#define USE_CLEARCOAT`:``,n.clearcoatMap?`#define USE_CLEARCOATMAP`:``,n.clearcoatRoughnessMap?`#define USE_CLEARCOAT_ROUGHNESSMAP`:``,n.clearcoatNormalMap?`#define USE_CLEARCOAT_NORMALMAP`:``,n.dispersion?`#define USE_DISPERSION`:``,n.retroreflection?`#define USE_RETROREFLECTION`:``,n.iridescence?`#define USE_IRIDESCENCE`:``,n.iridescenceMap?`#define USE_IRIDESCENCEMAP`:``,n.iridescenceThicknessMap?`#define USE_IRIDESCENCE_THICKNESSMAP`:``,n.specularMap?`#define USE_SPECULARMAP`:``,n.specularColorMap?`#define USE_SPECULAR_COLORMAP`:``,n.specularIntensityMap?`#define USE_SPECULAR_INTENSITYMAP`:``,n.roughnessMap?`#define USE_ROUGHNESSMAP`:``,n.metalnessMap?`#define USE_METALNESSMAP`:``,n.alphaMap?`#define USE_ALPHAMAP`:``,n.alphaTest?`#define USE_ALPHATEST`:``,n.alphaHash?`#define USE_ALPHAHASH`:``,n.sheen?`#define USE_SHEEN`:``,n.sheenColorMap?`#define USE_SHEEN_COLORMAP`:``,n.sheenRoughnessMap?`#define USE_SHEEN_ROUGHNESSMAP`:``,n.transmission?`#define USE_TRANSMISSION`:``,n.transmissionMap?`#define USE_TRANSMISSIONMAP`:``,n.thicknessMap?`#define USE_THICKNESSMAP`:``,n.vertexTangents&&n.flatShading===!1?`#define USE_TANGENT`:``,n.vertexColors||n.instancingColor?`#define USE_COLOR`:``,n.vertexAlphas||n.batchingColor?`#define USE_COLOR_ALPHA`:``,n.vertexUv1s?`#define USE_UV1`:``,n.vertexUv2s?`#define USE_UV2`:``,n.vertexUv3s?`#define USE_UV3`:``,n.pointsUvs?`#define USE_POINTS_UV`:``,n.gradientMap?`#define USE_GRADIENTMAP`:``,n.flatShading?`#define FLAT_SHADED`:``,n.doubleSided?`#define DOUBLE_SIDED`:``,n.flipSided?`#define FLIP_SIDED`:``,n.shadowMapEnabled?`#define USE_SHADOWMAP`:``,n.shadowMapEnabled?`#define `+c:``,n.premultipliedAlpha?`#define PREMULTIPLIED_ALPHA`:``,n.numLightProbes>0?`#define USE_LIGHT_PROBES`:``,n.numLightProbeGrids>0?`#define USE_LIGHT_PROBES_GRID`:``,n.decodeVideoTexture?`#define DECODE_VIDEO_TEXTURE`:``,n.decodeVideoTextureEmissive?`#define DECODE_VIDEO_TEXTURE_EMISSIVE`:``,n.logarithmicDepthBuffer?`#define USE_LOGARITHMIC_DEPTH_BUFFER`:``,n.reversedDepthBuffer?`#define USE_REVERSED_DEPTH_BUFFER`:``,`uniform mat4 viewMatrix;`,`uniform vec3 cameraPosition;`,`uniform bool isOrthographic;`,n.toneMapping===0?``:`#define TONE_MAPPING`,n.toneMapping===0?``:Q.tonemapping_pars_fragment,n.toneMapping===0?``:Pi(`toneMapping`,n.toneMapping),n.dithering?`#define DITHERING`:``,n.opaque?`#define OPAQUE`:``,Q.colorspace_pars_fragment,Mi(`linearToOutputTexel`,n.outputColorSpace),Ii(),n.useDepthPacking?`#define DEPTH_PACKING `+n.depthPacking:``,`
`].filter(Bi).join(`
`)),o=Wi(o),o=Vi(o,n),o=Hi(o,n),s=Wi(s),s=Vi(s,n),s=Hi(s,n),o=Ji(o),s=Ji(s),n.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,g=[p,`#define attribute in`,`#define varying out`,`#define texture2D texture`].join(`
`)+`
`+g,_=[`#define varying in`,n.glslVersion===`300 es`?``:`layout(location = 0) out highp vec4 pc_fragColor;`,n.glslVersion===`300 es`?``:`#define gl_FragColor pc_fragColor`,`#define gl_FragDepthEXT gl_FragDepth`,`#define texture2D texture`,`#define textureCube texture`,`#define texture2DProj textureProj`,`#define texture2DLodEXT textureLod`,`#define texture2DProjLodEXT textureProjLod`,`#define textureCubeLodEXT textureLod`,`#define texture2DGradEXT textureGrad`,`#define texture2DProjGradEXT textureProjGrad`,`#define textureCubeGradEXT textureGrad`].join(`
`)+`
`+_);let y=v+g+o,b=v+_+s,x=Ti(i,i.VERTEX_SHADER,y),S=Ti(i,i.FRAGMENT_SHADER,b);i.attachShader(h,x),i.attachShader(h,S),n.index0AttributeName===void 0?n.hasPositionAttribute===!0&&i.bindAttribLocation(h,0,`position`):i.bindAttribLocation(h,0,n.index0AttributeName),i.linkProgram(h);function C(t){if(e.debug.checkShaderErrors){let n=i.getProgramInfoLog(h)||``,r=i.getShaderInfoLog(x)||``,a=i.getShaderInfoLog(S)||``,o=n.trim(),s=r.trim(),c=a.trim(),l=!0,u=!0;if(i.getProgramParameter(h,i.LINK_STATUS)===!1){if(l=!1,typeof e.debug.onShaderError==`function`)e.debug.onShaderError(i,h,x,S);else{let e=ji(i,x,`vertex`),n=ji(i,S,`fragment`);U(`WebGLProgram: Shader Error `+i.getError()+` - VALIDATE_STATUS `+i.getProgramParameter(h,i.VALIDATE_STATUS)+`

Material Name: `+t.name+`
Material Type: `+t.type+`

Program Info Log: `+o+`
`+e+`
`+n)}}else o===``?(s===``||c===``)&&(u=!1):G(`WebGLProgram: Program Info Log:`,o);u&&(t.diagnostics={runnable:l,programLog:o,vertexShader:{log:s,prefix:g},fragmentShader:{log:c,prefix:_}})}i.deleteShader(x),i.deleteShader(S),w=new wi(i,h),T=zi(i,h)}let w;this.getUniforms=function(){return w===void 0&&C(this),w};let T;this.getAttributes=function(){return T===void 0&&C(this),T};let E=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return E===!1&&(E=i.getProgramParameter(h,Ei)),E},this.destroy=function(){r.releaseStatesOfProgram(this),i.deleteProgram(h),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=Di++,this.cacheKey=t,this.usedTimes=1,this.program=h,this.vertexShader=x,this.fragmentShader=S,this}var sa=0,ca=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e,t,n){let r=this._getShaderCacheForMaterial(e);return r.has(t)===!1&&(r.add(t),t.usedTimes++),r.has(n)===!1&&(r.add(n),n.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let e of t)e.usedTimes--,e.usedTimes===0&&this.shaderCache.delete(e.code);return this.materialCache.delete(e),this}getVertexShaderStage(e){return this._getShaderStage(e.vertexShader)}getFragmentShaderStage(e){return this._getShaderStage(e.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new la(e),t.set(e,n)),n}},la=class{constructor(e){this.id=sa++,this.code=e,this.usedTimes=0}};function ua(e){return e===1030||e===37490||e===36285}function da(e,t,n,r,i,a){let o=new Be,s=new ca,c=new Set,l=[],u=new Map,d=r.logarithmicDepthBuffer,f=r.precision,p={MeshDepthMaterial:`depth`,MeshDistanceMaterial:`distance`,MeshNormalMaterial:`normal`,MeshBasicMaterial:`basic`,MeshLambertMaterial:`lambert`,MeshPhongMaterial:`phong`,MeshToonMaterial:`toon`,MeshStandardMaterial:`physical`,MeshPhysicalMaterial:`physical`,MeshMatcapMaterial:`matcap`,LineBasicMaterial:`basic`,LineDashedMaterial:`dashed`,PointsMaterial:`points`,ShadowMaterial:`shadow`,SpriteMaterial:`sprite`};function m(e){return c.add(e),e===0?`uv`:`uv${e}`}function h(i,o,l,u,h,g){let _=u.fog,v=h.geometry,y=i.isMeshStandardMaterial||i.isMeshLambertMaterial||i.isMeshPhongMaterial?u.environment:null,b=i.isMeshStandardMaterial||i.isMeshLambertMaterial&&!i.envMap||i.isMeshPhongMaterial&&!i.envMap,x=t.get(i.envMap||y,b),S=x&&x.mapping===306?x.image.height:null,C=p[i.type];i.precision!==null&&(f=r.getMaxPrecision(i.precision),f!==i.precision&&G(`WebGLProgram.getParameters:`,i.precision,`not supported, using`,f,`instead.`));let w=v.morphAttributes.position||v.morphAttributes.normal||v.morphAttributes.color,T=w===void 0?0:w.length,E=0;v.morphAttributes.position!==void 0&&(E=1),v.morphAttributes.normal!==void 0&&(E=2),v.morphAttributes.color!==void 0&&(E=3);let D,O,k,A;if(C){let e=Mn[C];D=e.vertexShader,O=e.fragmentShader}else{D=i.vertexShader,O=i.fragmentShader;let e=s.getVertexShaderStage(i),t=s.getFragmentShaderStage(i);s.update(i,e,t),k=e.id,A=t.id}let j=e.getRenderTarget(),M=e.state.buffers.depth.getReversed(),N=h.isInstancedMesh===!0,ee=h.isBatchedMesh===!0,P=!!i.map,te=!!i.matcap,ne=!!x,re=!!i.aoMap,ie=!!i.lightMap,ae=!!i.bumpMap&&i.wireframe===!1,F=!!i.normalMap,oe=!!i.displacementMap,I=!!i.emissiveMap,se=!!i.metalnessMap,ce=!!i.roughnessMap,le=i.anisotropy>0,ue=i.clearcoat>0,de=i.dispersion>0,fe=i.retroreflectivity>0,pe=i.iridescence>0,me=i.sheen>0,he=i.transmission>0,ge=le&&!!i.anisotropyMap,_e=ue&&!!i.clearcoatMap,ve=ue&&!!i.clearcoatNormalMap,ye=ue&&!!i.clearcoatRoughnessMap,be=pe&&!!i.iridescenceMap,L=pe&&!!i.iridescenceThicknessMap,xe=me&&!!i.sheenColorMap,R=me&&!!i.sheenRoughnessMap,Se=!!i.specularMap,z=!!i.specularColorMap,Ce=!!i.specularIntensityMap,B=he&&!!i.transmissionMap,V=he&&!!i.thicknessMap,we=!!i.gradientMap,Te=!!i.alphaMap,H=i.alphaTest>0,Ee=!!i.alphaHash,De=!!i.extensions,Oe=0;i.toneMapped&&(j===null||j.isXRRenderTarget===!0)&&(Oe=e.toneMapping);let ke={shaderID:C,shaderType:i.type,shaderName:i.name,vertexShader:D,fragmentShader:O,defines:i.defines,customVertexShaderID:k,customFragmentShaderID:A,isRawShaderMaterial:i.isRawShaderMaterial===!0,glslVersion:i.glslVersion,precision:f,batching:ee,batchingColor:ee&&h._colorsTexture!==null,instancing:N,instancingColor:N&&h.instanceColor!==null,instancingMorph:N&&h.morphTexture!==null,outputColorSpace:j===null?e.outputColorSpace:j.isXRRenderTarget===!0?j.texture.colorSpace:Ct.workingColorSpace,alphaToCoverage:!!i.alphaToCoverage,map:P,matcap:te,envMap:ne,envMapMode:ne&&x.mapping,envMapCubeUVHeight:S,aoMap:re,lightMap:ie,bumpMap:ae,normalMap:F,displacementMap:oe,emissiveMap:I,normalMapObjectSpace:F&&i.normalMapType===1,normalMapTangentSpace:F&&i.normalMapType===0,packedNormalMap:F&&i.normalMapType===0&&ua(i.normalMap.format),metalnessMap:se,roughnessMap:ce,anisotropy:le,anisotropyMap:ge,clearcoat:ue,clearcoatMap:_e,clearcoatNormalMap:ve,clearcoatRoughnessMap:ye,dispersion:de,retroreflection:fe,iridescence:pe,iridescenceMap:be,iridescenceThicknessMap:L,sheen:me,sheenColorMap:xe,sheenRoughnessMap:R,specularMap:Se,specularColorMap:z,specularIntensityMap:Ce,transmission:he,transmissionMap:B,thicknessMap:V,gradientMap:we,opaque:i.transparent===!1&&i.blending===1&&i.alphaToCoverage===!1,alphaMap:Te,alphaTest:H,alphaHash:Ee,combine:i.combine,mapUv:P&&m(i.map.channel),aoMapUv:re&&m(i.aoMap.channel),lightMapUv:ie&&m(i.lightMap.channel),bumpMapUv:ae&&m(i.bumpMap.channel),normalMapUv:F&&m(i.normalMap.channel),displacementMapUv:oe&&m(i.displacementMap.channel),emissiveMapUv:I&&m(i.emissiveMap.channel),metalnessMapUv:se&&m(i.metalnessMap.channel),roughnessMapUv:ce&&m(i.roughnessMap.channel),anisotropyMapUv:ge&&m(i.anisotropyMap.channel),clearcoatMapUv:_e&&m(i.clearcoatMap.channel),clearcoatNormalMapUv:ve&&m(i.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ye&&m(i.clearcoatRoughnessMap.channel),iridescenceMapUv:be&&m(i.iridescenceMap.channel),iridescenceThicknessMapUv:L&&m(i.iridescenceThicknessMap.channel),sheenColorMapUv:xe&&m(i.sheenColorMap.channel),sheenRoughnessMapUv:R&&m(i.sheenRoughnessMap.channel),specularMapUv:Se&&m(i.specularMap.channel),specularColorMapUv:z&&m(i.specularColorMap.channel),specularIntensityMapUv:Ce&&m(i.specularIntensityMap.channel),transmissionMapUv:B&&m(i.transmissionMap.channel),thicknessMapUv:V&&m(i.thicknessMap.channel),alphaMapUv:Te&&m(i.alphaMap.channel),vertexTangents:!!v.attributes.tangent&&(F||le),vertexNormals:!!v.attributes.normal,vertexColors:i.vertexColors,vertexAlphas:i.vertexColors===!0&&!!v.attributes.color&&v.attributes.color.itemSize===4,pointsUvs:h.isPoints===!0&&!!v.attributes.uv&&(P||Te),fog:!!_,useFog:i.fog===!0,fogExp2:!!_&&_.isFogExp2,flatShading:i.wireframe===!1&&(i.flatShading===!0||v.attributes.normal===void 0&&F===!1&&(i.isMeshLambertMaterial||i.isMeshPhongMaterial||i.isMeshStandardMaterial||i.isMeshPhysicalMaterial)),sizeAttenuation:i.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:M,skinning:h.isSkinnedMesh===!0,hasPositionAttribute:v.attributes.position!==void 0,morphTargets:v.morphAttributes.position!==void 0,morphNormals:v.morphAttributes.normal!==void 0,morphColors:v.morphAttributes.color!==void 0,morphTargetsCount:T,morphTextureStride:E,numSunLights:o.sun.length,numDirLights:o.directional.length,numPointLights:o.point.length,numSpotLights:o.spot.length,numSpotLightMaps:o.spotLightMap.length,numRectAreaLights:o.rectArea.length,numHemiLights:o.hemi.length,numSunLightShadows:o.sunShadowMap.length,numDirLightShadows:o.directionalShadowMap.length,numPointLightShadows:o.pointShadowMap.length,numSpotLightShadows:o.spotShadowMap.length,numSpotLightShadowsWithMaps:o.numSpotLightShadowsWithMaps,numLightProbes:o.numLightProbes,numLightProbeGrids:g.length,numClippingPlanes:a.numPlanes,numClipIntersection:a.numIntersection,dithering:i.dithering,shadowMapEnabled:e.shadowMap.enabled&&l.length>0,shadowMapType:e.shadowMap.type,toneMapping:Oe,decodeVideoTexture:P&&i.map.isVideoTexture===!0&&Ct.getTransfer(i.map.colorSpace)===`srgb`,decodeVideoTextureEmissive:I&&i.emissiveMap.isVideoTexture===!0&&Ct.getTransfer(i.emissiveMap.colorSpace)===`srgb`,premultipliedAlpha:i.premultipliedAlpha,doubleSided:i.side===2,flipSided:i.side===1,useDepthPacking:i.depthPacking>=0,depthPacking:i.depthPacking||0,index0AttributeName:i.index0AttributeName,extensionClipCullDistance:De&&i.extensions.clipCullDistance===!0&&n.has(`WEBGL_clip_cull_distance`),extensionMultiDraw:(De&&i.extensions.multiDraw===!0||ee)&&n.has(`WEBGL_multi_draw`),rendererExtensionParallelShaderCompile:n.has(`KHR_parallel_shader_compile`),customProgramCacheKey:i.customProgramCacheKey()};return ke.vertexUv1s=c.has(1),ke.vertexUv2s=c.has(2),ke.vertexUv3s=c.has(3),c.clear(),ke}function g(t){let n=[];if(t.shaderID?n.push(t.shaderID):(n.push(t.customVertexShaderID),n.push(t.customFragmentShaderID)),t.defines!==void 0)for(let e in t.defines)n.push(e),n.push(t.defines[e]);return t.isRawShaderMaterial===!1&&(_(n,t),v(n,t),n.push(e.outputColorSpace)),n.push(t.customProgramCacheKey),n.join()}function _(e,t){e.push(t.precision),e.push(t.outputColorSpace),e.push(t.envMapMode),e.push(t.envMapCubeUVHeight),e.push(t.mapUv),e.push(t.alphaMapUv),e.push(t.lightMapUv),e.push(t.aoMapUv),e.push(t.bumpMapUv),e.push(t.normalMapUv),e.push(t.displacementMapUv),e.push(t.emissiveMapUv),e.push(t.metalnessMapUv),e.push(t.roughnessMapUv),e.push(t.anisotropyMapUv),e.push(t.clearcoatMapUv),e.push(t.clearcoatNormalMapUv),e.push(t.clearcoatRoughnessMapUv),e.push(t.iridescenceMapUv),e.push(t.iridescenceThicknessMapUv),e.push(t.sheenColorMapUv),e.push(t.sheenRoughnessMapUv),e.push(t.specularMapUv),e.push(t.specularColorMapUv),e.push(t.specularIntensityMapUv),e.push(t.transmissionMapUv),e.push(t.thicknessMapUv),e.push(t.combine),e.push(t.fogExp2),e.push(t.sizeAttenuation),e.push(t.morphTargetsCount),e.push(t.morphAttributeCount),e.push(t.numSunLights),e.push(t.numDirLights),e.push(t.numPointLights),e.push(t.numSpotLights),e.push(t.numSpotLightMaps),e.push(t.numHemiLights),e.push(t.numRectAreaLights),e.push(t.numSunLightShadows),e.push(t.numDirLightShadows),e.push(t.numPointLightShadows),e.push(t.numSpotLightShadows),e.push(t.numSpotLightShadowsWithMaps),e.push(t.numLightProbes),e.push(t.shadowMapType),e.push(t.toneMapping),e.push(t.numClippingPlanes),e.push(t.numClipIntersection),e.push(t.depthPacking)}function v(e,t){o.disableAll(),t.instancing&&o.enable(0),t.instancingColor&&o.enable(1),t.instancingMorph&&o.enable(2),t.matcap&&o.enable(3),t.envMap&&o.enable(4),t.normalMapObjectSpace&&o.enable(5),t.normalMapTangentSpace&&o.enable(6),t.clearcoat&&o.enable(7),t.iridescence&&o.enable(8),t.alphaTest&&o.enable(9),t.vertexColors&&o.enable(10),t.vertexAlphas&&o.enable(11),t.vertexUv1s&&o.enable(12),t.vertexUv2s&&o.enable(13),t.vertexUv3s&&o.enable(14),t.vertexTangents&&o.enable(15),t.anisotropy&&o.enable(16),t.alphaHash&&o.enable(17),t.batching&&o.enable(18),t.dispersion&&o.enable(19),t.retroreflection&&o.enable(24),t.batchingColor&&o.enable(20),t.gradientMap&&o.enable(21),t.packedNormalMap&&o.enable(22),t.vertexNormals&&o.enable(23),e.push(o.mask),o.disableAll(),t.fog&&o.enable(0),t.useFog&&o.enable(1),t.flatShading&&o.enable(2),t.logarithmicDepthBuffer&&o.enable(3),t.reversedDepthBuffer&&o.enable(4),t.skinning&&o.enable(5),t.morphTargets&&o.enable(6),t.morphNormals&&o.enable(7),t.morphColors&&o.enable(8),t.premultipliedAlpha&&o.enable(9),t.shadowMapEnabled&&o.enable(10),t.doubleSided&&o.enable(11),t.flipSided&&o.enable(12),t.useDepthPacking&&o.enable(13),t.dithering&&o.enable(14),t.transmission&&o.enable(15),t.sheen&&o.enable(16),t.opaque&&o.enable(17),t.pointsUvs&&o.enable(18),t.decodeVideoTexture&&o.enable(19),t.decodeVideoTextureEmissive&&o.enable(20),t.alphaToCoverage&&o.enable(21),t.numLightProbeGrids>0&&o.enable(22),t.hasPositionAttribute&&o.enable(23),e.push(o.mask)}function y(e){let t=p[e.type],n;if(t){let e=Mn[t];n=zt.clone(e.uniforms)}else n=e.uniforms;return n}function b(t,n){let r=u.get(n);return r===void 0?(r=new oa(e,n,t,i),l.push(r),u.set(n,r)):++r.usedTimes,r}function x(e){if(--e.usedTimes===0){let t=l.indexOf(e);l[t]=l[l.length-1],l.pop(),u.delete(e.cacheKey),e.destroy()}}function S(e){s.remove(e)}function C(){s.dispose()}return{getParameters:h,getProgramCacheKey:g,getUniforms:y,acquireProgram:b,releaseProgram:x,releaseShaderCache:S,programs:l,dispose:C}}function fa(){let e=new WeakMap;function t(t){return e.has(t)}function n(t){let n=e.get(t);return n===void 0&&(n={},e.set(t,n)),n}function r(t){e.delete(t)}function i(t,n,r){e.get(t)[n]=r}function a(){e=new WeakMap}return{has:t,get:n,remove:r,update:i,dispose:a}}function pa(e,t){return e.groupOrder===t.groupOrder?e.renderOrder===t.renderOrder?e.material.id===t.material.id?e.materialVariant===t.materialVariant?e.z===t.z?e.id-t.id:e.z-t.z:e.materialVariant-t.materialVariant:e.material.id-t.material.id:e.renderOrder-t.renderOrder:e.groupOrder-t.groupOrder}function ma(e,t){return e.groupOrder===t.groupOrder?e.renderOrder===t.renderOrder?e.z===t.z?e.id-t.id:t.z-e.z:e.renderOrder-t.renderOrder:e.groupOrder-t.groupOrder}function ha(){let e=[],t=0,n=[],r=[],i=[];function a(){t=0,n.length=0,r.length=0,i.length=0}function o(e){let t=0;return e.isInstancedMesh&&(t+=2),e.isSkinnedMesh&&(t+=1),t}function s(n,r,i,a,s,c){let l=e[t];return l===void 0?(l={id:n.id,object:n,geometry:r,material:i,materialVariant:o(n),groupOrder:a,renderOrder:n.renderOrder,z:s,group:c},e[t]=l):(l.id=n.id,l.object=n,l.geometry=r,l.material=i,l.materialVariant=o(n),l.groupOrder=a,l.renderOrder=n.renderOrder,l.z=s,l.group=c),t++,l}function c(e,t,a,o,c,l,u){u.reversedDepth===!0&&(c=-c);let d=s(e,t,a,o,c,l);a.transmission>0?r.push(d):a.transparent===!0?i.push(d):n.push(d)}function l(e,t,a,o,c,l){let u=s(e,t,a,o,c,l);a.transmission>0?r.unshift(u):a.transparent===!0?i.unshift(u):n.unshift(u)}function u(e,t){n.length>1&&n.sort(e||pa),r.length>1&&r.sort(t||ma),i.length>1&&i.sort(t||ma)}function d(){for(let n=t,r=e.length;n<r;n++){let t=e[n];if(t.id===null)break;t.id=null,t.object=null,t.geometry=null,t.material=null,t.group=null}}return{opaque:n,transmissive:r,transparent:i,init:a,push:c,unshift:l,finish:d,sort:u}}function ga(){let e=new WeakMap;function t(t,n){let r=e.get(t),i;return r===void 0?(i=new ha,e.set(t,[i])):n>=r.length?(i=new ha,r.push(i)):i=r[n],i}function n(){e=new WeakMap}return{get:t,dispose:n}}function _a(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case`SunLight`:case`DirectionalLight`:n={direction:new Z,color:new Y};break;case`SpotLight`:n={position:new Z,direction:new Z,color:new Y,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case`PointLight`:n={position:new Z,color:new Y,distance:0,decay:0};break;case`HemisphereLight`:n={direction:new Z,skyColor:new Y,groundColor:new Y};break;case`RectAreaLight`:n={color:new Y,position:new Z,halfWidth:new Z,halfHeight:new Z}}return e[t.id]=n,n}}}function va(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case`SunLight`:case`DirectionalLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new X};break;case`SpotLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new X};break;case`PointLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new X,shadowCameraNear:1,shadowCameraFar:1e3}}return e[t.id]=n,n}}}var ya=0;function ba(e,t){return(t.castShadow?2:0)-(e.castShadow?2:0)+ +!!t.map-!!e.map}function xa(e){let t=new _a,n=va(),r={version:0,hash:{sunLength:-1,directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numSunShadows:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],sun:[],sunShadow:[],sunShadowMap:[],sunShadowMatrix:[],sunShadowCascade:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let e=0;e<9;e++)r.probe.push(new Z);let i=new Z,a=new Ke,o=new Ke;function s(i){let a=0,o=0,s=0;for(let e=0;e<9;e++)r.probe[e].set(0,0,0);let c=0,l=0,u=0,d=0,f=0,p=0,m=0,h=0,g=0,_=0,v=0,y=0,b=0,x=0;i.sort(ba);for(let e=0,S=i.length;e<S;e++){let S=i[e],C=S.color,w=S.intensity,T=S.distance,E=null;if(S.shadow&&S.shadow.map&&(E=S.shadow.map.texture.format===1030?S.shadow.map.texture:S.shadow.map.depthTexture||S.shadow.map.texture),S.isAmbientLight)a+=C.r*w,o+=C.g*w,s+=C.b*w;else if(S.isLightProbe){for(let e=0;e<9;e++)r.probe[e].addScaledVector(S.sh.coefficients[e],w);x++}else if(S.isSunLight){let e=t.get(S);if(e.color.copy(S.color).multiplyScalar(S.intensity),S.castShadow){let e=S.shadow,t=n.get(S);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize.copy(e.mapSize).multiply(e.getFrameExtents()),r.sunShadow[l]=t,r.sunShadowMap[l]=E;let i=e.getViewportCount();for(let t=0;t<i;t++)r.sunShadowMatrix[u+t]=e.getMatrix(t),r.sunShadowCascade[u+t]=e._cascadeData[t];u+=i,l++}r.sun[c]=e,c++}else if(S.isDirectionalLight){let e=t.get(S);if(e.color.copy(S.color).multiplyScalar(S.intensity),S.castShadow){let e=S.shadow,t=n.get(S);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,r.directionalShadow[d]=t,r.directionalShadowMap[d]=E,r.directionalShadowMatrix[d]=S.shadow.matrix,g++}r.directional[d]=e,d++}else if(S.isSpotLight){let e=t.get(S);e.position.setFromMatrixPosition(S.matrixWorld),e.color.copy(C).multiplyScalar(w),e.distance=T,e.coneCos=Math.cos(S.angle),e.penumbraCos=Math.cos(S.angle*(1-S.penumbra)),e.decay=S.decay,r.spot[p]=e;let i=S.shadow;if(S.map&&(r.spotLightMap[y]=S.map,y++,i.updateMatrices(S),S.castShadow&&b++),r.spotLightMatrix[p]=i.matrix,S.castShadow){let e=n.get(S);e.shadowIntensity=i.intensity,e.shadowBias=i.bias,e.shadowNormalBias=i.normalBias,e.shadowRadius=i.radius,e.shadowMapSize=i.mapSize,r.spotShadow[p]=e,r.spotShadowMap[p]=E,v++}p++}else if(S.isRectAreaLight){let e=t.get(S);e.color.copy(C).multiplyScalar(w),e.halfWidth.set(S.width*.5,0,0),e.halfHeight.set(0,S.height*.5,0),r.rectArea[m]=e,m++}else if(S.isPointLight){let e=t.get(S);if(e.color.copy(S.color).multiplyScalar(S.intensity),e.distance=S.distance,e.decay=S.decay,S.castShadow){let e=S.shadow,t=n.get(S);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,t.shadowCameraNear=e.camera.near,t.shadowCameraFar=e.camera.far,r.pointShadow[f]=t,r.pointShadowMap[f]=E,r.pointShadowMatrix[f]=S.shadow.matrix,_++}r.point[f]=e,f++}else if(S.isHemisphereLight){let e=t.get(S);e.skyColor.copy(S.color).multiplyScalar(w),e.groundColor.copy(S.groundColor).multiplyScalar(w),r.hemi[h]=e,h++}}m>0&&(e.has(`OES_texture_float_linear`)===!0?(r.rectAreaLTC1=$.LTC_FLOAT_1,r.rectAreaLTC2=$.LTC_FLOAT_2):(r.rectAreaLTC1=$.LTC_HALF_1,r.rectAreaLTC2=$.LTC_HALF_2)),r.ambient[0]=a,r.ambient[1]=o,r.ambient[2]=s;let S=r.hash;(S.sunLength!==c||S.directionalLength!==d||S.pointLength!==f||S.spotLength!==p||S.rectAreaLength!==m||S.hemiLength!==h||S.numSunShadows!==l||S.numDirectionalShadows!==g||S.numPointShadows!==_||S.numSpotShadows!==v||S.numSpotMaps!==y||S.numLightProbes!==x)&&(r.sun.length=c,r.directional.length=d,r.spot.length=p,r.rectArea.length=m,r.point.length=f,r.hemi.length=h,r.sunShadow.length=l,r.sunShadowMap.length=l,r.sunShadowMatrix.length=u,r.sunShadowCascade.length=u,r.directionalShadow.length=g,r.directionalShadowMap.length=g,r.directionalShadowMatrix.length=g,r.pointShadow.length=_,r.pointShadowMap.length=_,r.pointShadowMatrix.length=_,r.spotShadow.length=v,r.spotShadowMap.length=v,r.spotLightMatrix.length=v+y-b,r.spotLightMap.length=y,r.numSpotLightShadowsWithMaps=b,r.numLightProbes=x,S.sunLength=c,S.directionalLength=d,S.pointLength=f,S.spotLength=p,S.rectAreaLength=m,S.hemiLength=h,S.numSunShadows=l,S.numDirectionalShadows=g,S.numPointShadows=_,S.numSpotShadows=v,S.numSpotMaps=y,S.numLightProbes=x,r.version=ya++)}function c(e,t){let n=0,s=0,c=0,l=0,u=0,d=0,f=t.matrixWorldInverse;for(let t=0,p=e.length;t<p;t++){let p=e[t];if(p.isSunLight){let e=r.sun[n];e.direction.setFromMatrixPosition(p.matrixWorld),e.direction.transformDirection(f),n++}else if(p.isDirectionalLight){let e=r.directional[s];e.direction.setFromMatrixPosition(p.matrixWorld),i.setFromMatrixPosition(p.target.matrixWorld),e.direction.sub(i),e.direction.transformDirection(f),s++}else if(p.isSpotLight){let e=r.spot[l];e.position.setFromMatrixPosition(p.matrixWorld),e.position.applyMatrix4(f),e.direction.setFromMatrixPosition(p.matrixWorld),i.setFromMatrixPosition(p.target.matrixWorld),e.direction.sub(i),e.direction.transformDirection(f),l++}else if(p.isRectAreaLight){let e=r.rectArea[u];e.position.setFromMatrixPosition(p.matrixWorld),e.position.applyMatrix4(f),o.identity(),a.copy(p.matrixWorld),a.premultiply(f),o.extractRotation(a),e.halfWidth.set(p.width*.5,0,0),e.halfHeight.set(0,p.height*.5,0),e.halfWidth.applyMatrix4(o),e.halfHeight.applyMatrix4(o),u++}else if(p.isPointLight){let e=r.point[c];e.position.setFromMatrixPosition(p.matrixWorld),e.position.applyMatrix4(f),c++}else if(p.isHemisphereLight){let e=r.hemi[d];e.direction.setFromMatrixPosition(p.matrixWorld),e.direction.transformDirection(f),d++}}}return{setup:s,setupView:c,state:r}}function Sa(e){let t=new xa(e),n=[],r=[],i=[];function a(e){d.camera=e,n.length=0,r.length=0,i.length=0}function o(e){n.push(e)}function s(e){r.push(e)}function c(e){i.push(e)}function l(){t.setup(n)}function u(e){t.setupView(n,e)}let d={lightsArray:n,shadowsArray:r,lightProbeGridArray:i,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:a,state:d,setupLights:l,setupLightsView:u,pushLight:o,pushShadow:s,pushLightProbeGrid:c}}function Ca(e){let t=new WeakMap;function n(n,r=0){let i=t.get(n),a;return i===void 0?(a=new Sa(e),t.set(n,[a])):r>=i.length?(a=new Sa(e),i.push(a)):a=i[r],a}function r(){t=new WeakMap}return{get:n,dispose:r}}var wa=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Ta=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,Ea=[new Z(1,0,0),new Z(-1,0,0),new Z(0,1,0),new Z(0,-1,0),new Z(0,0,1),new Z(0,0,-1)],Da=[new Z(0,-1,0),new Z(0,-1,0),new Z(0,0,1),new Z(0,0,-1),new Z(0,-1,0),new Z(0,-1,0)],Oa=new Ke,ka=new Z,Aa=new Z;function ja(e,t,n){let r=new Ne,i=new X,a=new X,o=new K,s=new ft,c=new dt,l={},u=n.maxTextureSize,d={0:1,1:0,2:2},f=new J({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new X},radius:{value:4}},vertexShader:wa,fragmentShader:Ta}),p=f.clone();p.defines.HORIZONTAL_PASS=1;let m=new _t;m.setAttribute(`position`,new Mt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let h=new q(m,f),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=1;let _=this.type;this.render=function(t,n,s){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||t.length===0)return;this.type===2&&(G(`WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead.`),this.type=1);let c=e.getRenderTarget(),l=e.getActiveCubeFace(),d=e.getActiveMipmapLevel(),f=e.state;f.setBlending(0),f.buffers.depth.getReversed()===!0?f.buffers.color.setClear(0,0,0,0):f.buffers.color.setClear(1,1,1,1),f.buffers.depth.setTest(!0),f.setScissorTest(!1);let p=_!==this.type;p&&n.traverse(function(e){e.material&&(Array.isArray(e.material)?e.material.forEach(e=>e.needsUpdate=!0):e.material.needsUpdate=!0)});for(let c=0,l=t.length;c<l;c++){let l=t[c],d=l.shadow;if(d===void 0){G(`WebGLShadowMap:`,l,`has no shadow.`);continue}if(d.autoUpdate===!1&&d.needsUpdate===!1)continue;i.copy(d.mapSize);let m=d.getFrameExtents();i.multiply(m),a.copy(d.mapSize),(i.x>u||i.y>u)&&(i.x>u&&(a.x=Math.floor(u/m.x),i.x=a.x*m.x,d.mapSize.x=a.x),i.y>u&&(a.y=Math.floor(u/m.y),i.y=a.y*m.y,d.mapSize.y=a.y));let h=e.state.buffers.depth.getReversed();if(d.camera._reversedDepth=h,d.map===null||p===!0){if(d.map!==null&&(d.map.depthTexture!==null&&(d.map.depthTexture.dispose(),d.map.depthTexture=null),d.map.dispose()),this.type===3){if(l.isPointLight){G(`WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.`);continue}d.map=new it(i.x,i.y,{format:ct,type:Ze,minFilter:cn,magFilter:cn,generateMipmaps:!1}),d.map.texture.name=l.name+`.shadowMap`,d.map.depthTexture=new Ie(i.x,i.y,Qe),d.map.depthTexture.name=l.name+`.shadowMapDepth`,d.map.depthTexture.format=an,d.map.depthTexture.compareFunction=null,d.map.depthTexture.minFilter=tt,d.map.depthTexture.magFilter=tt}else l.isPointLight?(d.map=new cr(i.x),d.map.depthTexture=new Ot(i.x,Vt)):(d.map=new it(i.x,i.y),d.map.depthTexture=new Ie(i.x,i.y,Vt)),d.map.depthTexture.name=l.name+`.shadowMap`,d.map.depthTexture.format=an,this.type===1?(d.map.depthTexture.compareFunction=h?518:515,d.map.depthTexture.minFilter=cn,d.map.depthTexture.magFilter=cn):(d.map.depthTexture.compareFunction=null,d.map.depthTexture.minFilter=tt,d.map.depthTexture.magFilter=tt);d.camera.updateProjectionMatrix()}d.map.isWebGLCubeRenderTarget!==!0&&(d.map.width!==i.x||d.map.height!==i.y)&&d.map.setSize(i.x,i.y);let g=d.map.isWebGLCubeRenderTarget?6:d.getViewportCount();l.isPointLight!==!0&&d.updateMatrices(l,s);for(let t=0;t<g;t++){let i=d.getCamera(t);if(l.isPointLight){let e=d.camera,n=d.matrix,r=l.distance||e.far;r!==e.far&&(e.far=r,e.updateProjectionMatrix()),ka.setFromMatrixPosition(l.matrixWorld),e.position.copy(ka),Aa.copy(e.position),Aa.add(Ea[t]),e.up.copy(Da[t]),e.lookAt(Aa),e.updateMatrixWorld(),n.makeTranslation(-ka.x,-ka.y,-ka.z),Oa.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),d._frustum.setFromProjectionMatrix(Oa,e.coordinateSystem,e.reversedDepth)}if(d.map.isWebGLCubeRenderTarget)e.setRenderTarget(d.map,t),e.clear();else{t===0&&(e.setRenderTarget(d.map),e.clear());let n=d.getViewport(t);o.set(a.x*n.x,a.y*n.y,a.x*n.z,a.y*n.w),f.viewport(o)}r=d.getFrustum(t),b(n,s,i,l,this.type)}d.isPointLightShadow!==!0&&this.type===3&&v(d,s),d.needsUpdate=!1}_=this.type,g.needsUpdate=!1,e.setRenderTarget(c,l,d)};function v(n,r){let a=t.update(h);f.defines.VSM_SAMPLES!==n.blurSamples&&(f.defines.VSM_SAMPLES=n.blurSamples,p.defines.VSM_SAMPLES=n.blurSamples,f.needsUpdate=!0,p.needsUpdate=!0),n.mapPass===null?n.mapPass=new it(i.x,i.y,{format:ct,type:Ze}):(n.mapPass.width!==n.map.width||n.mapPass.height!==n.map.height)&&n.mapPass.setSize(n.map.width,n.map.height),f.uniforms.shadow_pass.value=n.map.depthTexture,f.uniforms.resolution.value.set(n.map.width,n.map.height),f.uniforms.radius.value=n.radius,e.setRenderTarget(n.mapPass),e.clear(),e.renderBufferDirect(r,null,a,f,h,null),p.uniforms.shadow_pass.value=n.mapPass.texture,p.uniforms.resolution.value.set(n.map.width,n.map.height),p.uniforms.radius.value=n.radius,e.setRenderTarget(n.map),e.clear(),e.renderBufferDirect(r,null,a,p,h,null)}function y(t,n,r,i){let a=null,o=r.isPointLight===!0?t.customDistanceMaterial:t.customDepthMaterial;if(o!==void 0)a=o;else if(a=r.isPointLight===!0?c:s,e.localClippingEnabled&&n.clipShadows===!0&&Array.isArray(n.clippingPlanes)&&n.clippingPlanes.length!==0||n.displacementMap&&n.displacementScale!==0||n.alphaMap&&n.alphaTest>0||n.map&&n.alphaTest>0||n.alphaToCoverage===!0){let e=a.uuid,t=n.uuid,r=l[e];r===void 0&&(r={},l[e]=r);let i=r[t];i===void 0&&(i=a.clone(),r[t]=i,n.addEventListener(`dispose`,x)),a=i}if(a.visible=n.visible,a.wireframe=n.wireframe,i===3?a.side=n.shadowSide===null?n.side:n.shadowSide:a.side=n.shadowSide===null?d[n.side]:n.shadowSide,a.alphaMap=n.alphaMap,a.alphaTest=n.alphaToCoverage===!0?.5:n.alphaTest,a.map=n.map,a.clipShadows=n.clipShadows,a.clippingPlanes=n.clippingPlanes,a.clipIntersection=n.clipIntersection,a.displacementMap=n.displacementMap,a.displacementScale=n.displacementScale,a.displacementBias=n.displacementBias,a.wireframeLinewidth=n.wireframeLinewidth,a.linewidth=n.linewidth,r.isPointLight===!0&&a.isMeshDistanceMaterial===!0){let t=e.properties.get(a);t.light=r}return a}function b(n,i,a,o,s){if(n.visible===!1)return;if(n.layers.test(i.layers)&&(n.isMesh||n.isLine||n.isPoints)&&(n.castShadow||n.receiveShadow&&s===3)&&(!n.frustumCulled||n.intersectsFrustum(r))){n.modelViewMatrix.multiplyMatrices(a.matrixWorldInverse,n.matrixWorld);let r=t.update(n),c=n.material;if(Array.isArray(c)){let t=r.groups;for(let l=0,u=t.length;l<u;l++){let u=t[l],d=c[u.materialIndex];if(d&&d.visible){let t=y(n,d,o,s);n.onBeforeShadow(e,n,i,a,r,t,u),e.renderBufferDirect(a,null,r,t,n,u),n.onAfterShadow(e,n,i,a,r,t,u)}}}else if(c.visible){let t=y(n,c,o,s);n.onBeforeShadow(e,n,i,a,r,t,null),e.renderBufferDirect(a,null,r,t,n,null),n.onAfterShadow(e,n,i,a,r,t,null)}}let c=n.children;for(let e=0,t=c.length;e<t;e++)b(c[e],i,a,o,s)}function x(e){e.target.removeEventListener(`dispose`,x);for(let t in l){let n=l[t],r=e.target.uuid;r in n&&(n[r].dispose(),delete n[r])}}}function Ma(e,t){function n(){let t=!1,n=new K,r=null,i=new K(0,0,0,0);return{setMask:function(n){r!==n&&!t&&(e.colorMask(n,n,n,n),r=n)},setLocked:function(e){t=e},setClear:function(t,r,a,o,s){s===!0&&(t*=o,r*=o,a*=o),n.set(t,r,a,o),i.equals(n)===!1&&(e.clearColor(t,r,a,o),i.copy(n))},reset:function(){t=!1,r=null,i.set(-1,0,0,0)}}}function r(){let n=!1,r=!1,i=null,a=null,o=null;return{setReversed:function(e){if(r!==e){let n=t.get(`EXT_clip_control`);e?n.clipControlEXT(n.LOWER_LEFT_EXT,n.ZERO_TO_ONE_EXT):n.clipControlEXT(n.LOWER_LEFT_EXT,n.NEGATIVE_ONE_TO_ONE_EXT),r=e;let i=o;o=null,this.setClear(i)}},getReversed:function(){return r},setTest:function(t){t?se(e.DEPTH_TEST):ce(e.DEPTH_TEST)},setMask:function(t){i!==t&&!n&&(e.depthMask(t),i=t)},setFunc:function(t){if(r&&(t=pt[t]),a!==t){switch(t){case 0:e.depthFunc(e.NEVER);break;case 1:e.depthFunc(e.ALWAYS);break;case 2:e.depthFunc(e.LESS);break;case 3:e.depthFunc(e.LEQUAL);break;case 4:e.depthFunc(e.EQUAL);break;case 5:e.depthFunc(e.GEQUAL);break;case 6:e.depthFunc(e.GREATER);break;case 7:e.depthFunc(e.NOTEQUAL);break;default:e.depthFunc(e.LEQUAL)}a=t}},setLocked:function(e){n=e},setClear:function(t){o!==t&&(o=t,r&&(t=1-t),e.clearDepth(t))},reset:function(){n=!1,i=null,a=null,o=null,r=!1}}}function i(){let t=!1,n=null,r=null,i=null,a=null,o=null,s=null,c=null,l=null;return{setTest:function(n){t||(n?se(e.STENCIL_TEST):ce(e.STENCIL_TEST))},setMask:function(r){n!==r&&!t&&(e.stencilMask(r),n=r)},setFunc:function(t,n,o){(r!==t||i!==n||a!==o)&&(e.stencilFunc(t,n,o),r=t,i=n,a=o)},setOp:function(t,n,r){(o!==t||s!==n||c!==r)&&(e.stencilOp(t,n,r),o=t,s=n,c=r)},setLocked:function(e){t=e},setClear:function(t){l!==t&&(e.clearStencil(t),l=t)},reset:function(){t=!1,n=null,r=null,i=null,a=null,o=null,s=null,c=null,l=null}}}let a=new n,o=new r,s=new i,c=new WeakMap,l=new WeakMap,u={},d={},f={},p=new WeakMap,m=[],h=null,g=!1,_=null,v=null,y=null,b=null,x=null,S=null,C=null,w=new Y(0,0,0),T=0,E=!1,D=null,O=null,k=null,A=null,j=null,M=e.getParameter(e.MAX_COMBINED_TEXTURE_IMAGE_UNITS),N=!1,ee=0,P=e.getParameter(e.VERSION);P.indexOf(`WebGL`)===-1?P.indexOf(`OpenGL ES`)!==-1&&(ee=parseFloat(/^OpenGL ES (\d)/.exec(P)[1]),N=ee>=2):(ee=parseFloat(/^WebGL (\d)/.exec(P)[1]),N=ee>=1);let te=null,ne={},re=e.getParameter(e.SCISSOR_BOX),ie=e.getParameter(e.VIEWPORT),ae=new K().fromArray(re),F=new K().fromArray(ie);function oe(t,n,r,i){let a=new Uint8Array(4),o=e.createTexture();e.bindTexture(t,o),e.texParameteri(t,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(t,e.TEXTURE_MAG_FILTER,e.NEAREST);for(let o=0;o<r;o++)t===e.TEXTURE_3D||t===e.TEXTURE_2D_ARRAY?e.texImage3D(n,0,e.RGBA,1,1,i,0,e.RGBA,e.UNSIGNED_BYTE,a):e.texImage2D(n+o,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,a);return o}let I={};I[e.TEXTURE_2D]=oe(e.TEXTURE_2D,e.TEXTURE_2D,1),I[e.TEXTURE_CUBE_MAP]=oe(e.TEXTURE_CUBE_MAP,e.TEXTURE_CUBE_MAP_POSITIVE_X,6),I[e.TEXTURE_2D_ARRAY]=oe(e.TEXTURE_2D_ARRAY,e.TEXTURE_2D_ARRAY,1,1),I[e.TEXTURE_3D]=oe(e.TEXTURE_3D,e.TEXTURE_3D,1,1),a.setClear(0,0,0,1),o.setClear(1),s.setClear(0),se(e.DEPTH_TEST),o.setFunc(3),ge(!1),_e(1),se(e.CULL_FACE),me(0);function se(t){u[t]!==!0&&(e.enable(t),u[t]=!0)}function ce(t){u[t]!==!1&&(e.disable(t),u[t]=!1)}function le(t,n){return f[t]!==n&&(e.bindFramebuffer(t,n),f[t]=n,t===e.DRAW_FRAMEBUFFER&&(f[e.FRAMEBUFFER]=n),t===e.FRAMEBUFFER&&(f[e.DRAW_FRAMEBUFFER]=n),!0)}function ue(t,n){let r=m,i=!1;if(t){r=p.get(n),r===void 0&&(r=[],p.set(n,r));let a=t.textures;if(r.length!==a.length||r[0]!==e.COLOR_ATTACHMENT0){for(let t=0,n=a.length;t<n;t++)r[t]=e.COLOR_ATTACHMENT0+t;r.length=a.length,i=!0}}else r[0]!==e.BACK&&(r[0]=e.BACK,i=!0);i&&e.drawBuffers(r)}function de(t){return h!==t&&(e.useProgram(t),h=t,!0)}let fe={100:e.FUNC_ADD,101:e.FUNC_SUBTRACT,102:e.FUNC_REVERSE_SUBTRACT};fe[103]=e.MIN,fe[104]=e.MAX;let pe={200:e.ZERO,201:e.ONE,202:e.SRC_COLOR,204:e.SRC_ALPHA,210:e.SRC_ALPHA_SATURATE,208:e.DST_COLOR,206:e.DST_ALPHA,203:e.ONE_MINUS_SRC_COLOR,205:e.ONE_MINUS_SRC_ALPHA,209:e.ONE_MINUS_DST_COLOR,207:e.ONE_MINUS_DST_ALPHA,211:e.CONSTANT_COLOR,212:e.ONE_MINUS_CONSTANT_COLOR,213:e.CONSTANT_ALPHA,214:e.ONE_MINUS_CONSTANT_ALPHA};function me(t,n,r,i,a,o,s,c,l,u){if(t===0){g===!0&&(ce(e.BLEND),g=!1);return}if(g===!1&&(se(e.BLEND),g=!0),t!==5){if(t!==_||u!==E){if((v!==100||x!==100)&&(e.blendEquation(e.FUNC_ADD),v=100,x=100),u)switch(t){case 1:e.blendFuncSeparate(e.ONE,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFunc(e.ONE,e.ONE);break;case 3:e.blendFuncSeparate(e.ZERO,e.ONE_MINUS_SRC_COLOR,e.ZERO,e.ONE);break;case 4:e.blendFuncSeparate(e.DST_COLOR,e.ONE_MINUS_SRC_ALPHA,e.ZERO,e.ONE);break;default:U(`WebGLState: Invalid blending: `,t)}else switch(t){case 1:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE,e.ONE,e.ONE);break;case 3:U(`WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true`);break;case 4:U(`WebGLState: MultiplyBlending requires material.premultipliedAlpha = true`);break;default:U(`WebGLState: Invalid blending: `,t)}y=null,b=null,S=null,C=null,w.set(0,0,0),T=0,_=t,E=u}return}a||=n,o||=r,s||=i,(n!==v||a!==x)&&(e.blendEquationSeparate(fe[n],fe[a]),v=n,x=a),(r!==y||i!==b||o!==S||s!==C)&&(e.blendFuncSeparate(pe[r],pe[i],pe[o],pe[s]),y=r,b=i,S=o,C=s),(c.equals(w)===!1||l!==T)&&(e.blendColor(c.r,c.g,c.b,l),w.copy(c),T=l),_=t,E=!1}function he(t,n){t.side===2?ce(e.CULL_FACE):se(e.CULL_FACE);let r=t.side===1;n&&(r=!r),ge(r),t.blending===1&&t.transparent===!1?me(0):me(t.blending,t.blendEquation,t.blendSrc,t.blendDst,t.blendEquationAlpha,t.blendSrcAlpha,t.blendDstAlpha,t.blendColor,t.blendAlpha,t.premultipliedAlpha),o.setFunc(t.depthFunc),o.setTest(t.depthTest),o.setMask(t.depthWrite),a.setMask(t.colorWrite);let i=t.stencilWrite;s.setTest(i),i&&(s.setMask(t.stencilWriteMask),s.setFunc(t.stencilFunc,t.stencilRef,t.stencilFuncMask),s.setOp(t.stencilFail,t.stencilZFail,t.stencilZPass)),ye(t.polygonOffset,t.polygonOffsetFactor,t.polygonOffsetUnits),t.alphaToCoverage===!0?se(e.SAMPLE_ALPHA_TO_COVERAGE):ce(e.SAMPLE_ALPHA_TO_COVERAGE)}function ge(t){D!==t&&(t?e.frontFace(e.CW):e.frontFace(e.CCW),D=t)}function _e(t){t===0?ce(e.CULL_FACE):(se(e.CULL_FACE),t!==O&&(t===1?e.cullFace(e.BACK):t===2?e.cullFace(e.FRONT):e.cullFace(e.FRONT_AND_BACK))),O=t}function ve(t){t!==k&&(N&&e.lineWidth(t),k=t)}function ye(t,n,r){t?(se(e.POLYGON_OFFSET_FILL),(A!==n||j!==r)&&(A=n,j=r,o.getReversed()&&(n=-n),e.polygonOffset(n,r))):ce(e.POLYGON_OFFSET_FILL)}function be(t){t?se(e.SCISSOR_TEST):ce(e.SCISSOR_TEST)}function L(t){t===void 0&&(t=e.TEXTURE0+M-1),te!==t&&(e.activeTexture(t),te=t)}function xe(t,n,r){r===void 0&&(r=te===null?e.TEXTURE0+M-1:te);let i=ne[r];i===void 0&&(i={type:void 0,texture:void 0},ne[r]=i),(i.type!==t||i.texture!==n)&&(te!==r&&(e.activeTexture(r),te=r),e.bindTexture(t,n||I[t]),i.type=t,i.texture=n)}function R(){let t=ne[te];t!==void 0&&t.type!==void 0&&(e.bindTexture(t.type,null),t.type=void 0,t.texture=void 0)}function Se(){try{e.compressedTexImage2D(...arguments)}catch(e){U(`WebGLState:`,e)}}function z(){try{e.compressedTexImage3D(...arguments)}catch(e){U(`WebGLState:`,e)}}function Ce(){try{e.texSubImage2D(...arguments)}catch(e){U(`WebGLState:`,e)}}function B(){try{e.texSubImage3D(...arguments)}catch(e){U(`WebGLState:`,e)}}function V(){try{e.compressedTexSubImage2D(...arguments)}catch(e){U(`WebGLState:`,e)}}function we(){try{e.compressedTexSubImage3D(...arguments)}catch(e){U(`WebGLState:`,e)}}function Te(){try{e.texStorage2D(...arguments)}catch(e){U(`WebGLState:`,e)}}function H(){try{e.texStorage3D(...arguments)}catch(e){U(`WebGLState:`,e)}}function Ee(){try{e.texImage2D(...arguments)}catch(e){U(`WebGLState:`,e)}}function De(){try{e.texImage3D(...arguments)}catch(e){U(`WebGLState:`,e)}}function Oe(t){return d[t]===void 0?e.getParameter(t):d[t]}function ke(t,n){d[t]!==n&&(e.pixelStorei(t,n),d[t]=n)}function Ae(t){ae.equals(t)===!1&&(e.scissor(t.x,t.y,t.z,t.w),ae.copy(t))}function je(t){F.equals(t)===!1&&(e.viewport(t.x,t.y,t.z,t.w),F.copy(t))}function Me(t,n){let r=l.get(n);r===void 0&&(r=new WeakMap,l.set(n,r));let i=r.get(t);i===void 0&&(i=e.getUniformBlockIndex(n,t.name),r.set(t,i))}function Ne(t,n){let r=l.get(n).get(t);c.get(n)!==r&&(e.uniformBlockBinding(n,r,t.__bindingPointIndex),c.set(n,r))}function Pe(){e.disable(e.BLEND),e.disable(e.CULL_FACE),e.disable(e.DEPTH_TEST),e.disable(e.POLYGON_OFFSET_FILL),e.disable(e.SCISSOR_TEST),e.disable(e.STENCIL_TEST),e.disable(e.SAMPLE_ALPHA_TO_COVERAGE),e.blendEquation(e.FUNC_ADD),e.blendFunc(e.ONE,e.ZERO),e.blendFuncSeparate(e.ONE,e.ZERO,e.ONE,e.ZERO),e.blendColor(0,0,0,0),e.colorMask(!0,!0,!0,!0),e.clearColor(0,0,0,0),e.depthMask(!0),e.depthFunc(e.LESS),o.setReversed(!1),e.clearDepth(1),e.stencilMask(4294967295),e.stencilFunc(e.ALWAYS,0,4294967295),e.stencilOp(e.KEEP,e.KEEP,e.KEEP),e.clearStencil(0),e.cullFace(e.BACK),e.frontFace(e.CCW),e.polygonOffset(0,0),e.activeTexture(e.TEXTURE0),e.bindFramebuffer(e.FRAMEBUFFER,null),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),e.bindFramebuffer(e.READ_FRAMEBUFFER,null),e.useProgram(null),e.lineWidth(1),e.scissor(0,0,e.canvas.width,e.canvas.height),e.viewport(0,0,e.canvas.width,e.canvas.height),e.pixelStorei(e.PACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,e.BROWSER_DEFAULT_WEBGL),e.pixelStorei(e.PACK_ROW_LENGTH,0),e.pixelStorei(e.PACK_SKIP_PIXELS,0),e.pixelStorei(e.PACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_ROW_LENGTH,0),e.pixelStorei(e.UNPACK_IMAGE_HEIGHT,0),e.pixelStorei(e.UNPACK_SKIP_PIXELS,0),e.pixelStorei(e.UNPACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_SKIP_IMAGES,0),u={},d={},te=null,ne={},f={},p=new WeakMap,m=[],h=null,g=!1,_=null,v=null,y=null,b=null,x=null,S=null,C=null,w=new Y(0,0,0),T=0,E=!1,D=null,O=null,k=null,A=null,j=null,ae.set(0,0,e.canvas.width,e.canvas.height),F.set(0,0,e.canvas.width,e.canvas.height),a.reset(),o.reset(),s.reset()}return{buffers:{color:a,depth:o,stencil:s},enable:se,disable:ce,bindFramebuffer:le,drawBuffers:ue,useProgram:de,setBlending:me,setMaterial:he,setFlipSided:ge,setCullFace:_e,setLineWidth:ve,setPolygonOffset:ye,setScissorTest:be,activeTexture:L,bindTexture:xe,unbindTexture:R,compressedTexImage2D:Se,compressedTexImage3D:z,texImage2D:Ee,texImage3D:De,pixelStorei:ke,getParameter:Oe,updateUBOMapping:Me,uniformBlockBinding:Ne,texStorage2D:Te,texStorage3D:H,texSubImage2D:Ce,texSubImage3D:B,compressedTexSubImage2D:V,compressedTexSubImage3D:we,scissor:Ae,viewport:je,reset:Pe}}function Na(e,t,n,r,i,a,o){let s=t.has(`WEBGL_multisampled_render_to_texture`)?t.get(`WEBGL_multisampled_render_to_texture`):null,c=typeof navigator>`u`?!1:/OculusBrowser/g.test(navigator.userAgent),l=new X,u=new WeakMap,d=new Set,f,p=new WeakMap,m=!1;try{m=typeof OffscreenCanvas<`u`&&new OffscreenCanvas(1,1).getContext(`2d`)!==null}catch{}function h(e,t){return m?new OffscreenCanvas(e,t):ze(`canvas`)}function g(e,t,n){let r=1,i=Se(e);if((i.width>n||i.height>n)&&(r=n/Math.max(i.width,i.height)),r<1){if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap||typeof VideoFrame<`u`&&e instanceof VideoFrame){let n=Math.floor(r*i.width),a=Math.floor(r*i.height);f===void 0&&(f=h(n,a));let o=t?h(n,a):f;return o.width=n,o.height=a,o.getContext(`2d`).drawImage(e,0,0,n,a),G(`WebGLRenderer: Texture has been resized from (`+i.width+`x`+i.height+`) to (`+n+`x`+a+`).`),o}return`data`in e&&G(`WebGLRenderer: Image in DataTexture is too big (`+i.width+`x`+i.height+`).`),e}return e}function _(e){return e.generateMipmaps}function v(t){e.generateMipmap(t)}function y(t){return t.isWebGLCubeRenderTarget?e.TEXTURE_CUBE_MAP:t.isWebGL3DRenderTarget?e.TEXTURE_3D:t.isWebGLArrayRenderTarget||t.isCompressedArrayTexture?e.TEXTURE_2D_ARRAY:e.TEXTURE_2D}function b(n,r,i,a,o,s=!1){if(n!==null){if(e[n]!==void 0)return e[n];G(`WebGLRenderer: Attempt to use non-existing WebGL internal format '`+n+`'`)}let c;a&&(c=t.get(`EXT_texture_norm16`),c||G(`WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension`));let l=r;if(r===e.RED&&(i===e.FLOAT&&(l=e.R32F),i===e.HALF_FLOAT&&(l=e.R16F),i===e.UNSIGNED_BYTE&&(l=e.R8),i===e.UNSIGNED_SHORT&&c&&(l=c.R16_EXT),i===e.SHORT&&c&&(l=c.R16_SNORM_EXT)),r===e.RED_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.R8UI),i===e.UNSIGNED_SHORT&&(l=e.R16UI),i===e.UNSIGNED_INT&&(l=e.R32UI),i===e.BYTE&&(l=e.R8I),i===e.SHORT&&(l=e.R16I),i===e.INT&&(l=e.R32I)),r===e.RG&&(i===e.FLOAT&&(l=e.RG32F),i===e.HALF_FLOAT&&(l=e.RG16F),i===e.UNSIGNED_BYTE&&(l=e.RG8),i===e.UNSIGNED_SHORT&&c&&(l=c.RG16_EXT),i===e.SHORT&&c&&(l=c.RG16_SNORM_EXT)),r===e.RG_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RG8UI),i===e.UNSIGNED_SHORT&&(l=e.RG16UI),i===e.UNSIGNED_INT&&(l=e.RG32UI),i===e.BYTE&&(l=e.RG8I),i===e.SHORT&&(l=e.RG16I),i===e.INT&&(l=e.RG32I)),r===e.RGB_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RGB8UI),i===e.UNSIGNED_SHORT&&(l=e.RGB16UI),i===e.UNSIGNED_INT&&(l=e.RGB32UI),i===e.BYTE&&(l=e.RGB8I),i===e.SHORT&&(l=e.RGB16I),i===e.INT&&(l=e.RGB32I)),r===e.RGBA_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RGBA8UI),i===e.UNSIGNED_SHORT&&(l=e.RGBA16UI),i===e.UNSIGNED_INT&&(l=e.RGBA32UI),i===e.BYTE&&(l=e.RGBA8I),i===e.SHORT&&(l=e.RGBA16I),i===e.INT&&(l=e.RGBA32I)),r===e.RGB&&(i===e.UNSIGNED_SHORT&&c&&(l=c.RGB16_EXT),i===e.SHORT&&c&&(l=c.RGB16_SNORM_EXT),i===e.UNSIGNED_INT_5_9_9_9_REV&&(l=e.RGB9_E5),i===e.UNSIGNED_INT_10F_11F_11F_REV&&(l=e.R11F_G11F_B10F)),r===e.RGBA){let t=s?st:Ct.getTransfer(o);i===e.FLOAT&&(l=e.RGBA32F),i===e.HALF_FLOAT&&(l=e.RGBA16F),i===e.UNSIGNED_BYTE&&(l=t===`srgb`?e.SRGB8_ALPHA8:e.RGBA8),i===e.UNSIGNED_SHORT&&c&&(l=c.RGBA16_EXT),i===e.SHORT&&c&&(l=c.RGBA16_SNORM_EXT),i===e.UNSIGNED_SHORT_4_4_4_4&&(l=e.RGBA4),i===e.UNSIGNED_SHORT_5_5_5_1&&(l=e.RGB5_A1)}return(l===e.R16F||l===e.R32F||l===e.RG16F||l===e.RG32F||l===e.RGBA16F||l===e.RGBA32F)&&t.get(`EXT_color_buffer_float`),l}function x(t,n){let r;return t?n===null||n===1014||n===1020?r=e.DEPTH24_STENCIL8:n===1015?r=e.DEPTH32F_STENCIL8:n===1012&&(r=e.DEPTH24_STENCIL8,G(`DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.`)):n===null||n===1014||n===1020?r=e.DEPTH_COMPONENT24:n===1015?r=e.DEPTH_COMPONENT32F:n===1012&&(r=e.DEPTH_COMPONENT16),r}function S(e,t){return _(e)===!0||e.isFramebufferTexture&&e.minFilter!==1003&&e.minFilter!==1006?Math.log2(Math.max(t.width,t.height))+1:e.mipmaps!==void 0&&e.mipmaps.length>0?e.mipmaps.length:e.isCompressedTexture&&Array.isArray(e.image)?t.mipmaps.length:1}function C(e){let t=e.target;t.removeEventListener(`dispose`,C),T(t),t.isVideoTexture&&u.delete(t),t.isHTMLTexture&&d.delete(t)}function w(e){let t=e.target;t.removeEventListener(`dispose`,w),D(t)}function T(e){let t=r.get(e);if(t.__webglInit===void 0)return;let n=e.source,i=p.get(n);if(i){let r=i[t.__cacheKey];r.usedTimes--,r.usedTimes===0&&E(e),Object.keys(i).length===0&&p.delete(n)}r.remove(e)}function E(t){let n=r.get(t);e.deleteTexture(n.__webglTexture);let i=t.source,a=p.get(i);delete a[n.__cacheKey],o.memory.textures--}function D(t){let n=r.get(t);if(t.depthTexture&&(t.depthTexture.dispose(),r.remove(t.depthTexture)),t.isWebGLCubeRenderTarget)for(let t=0;t<6;t++){if(Array.isArray(n.__webglFramebuffer[t]))for(let r=0;r<n.__webglFramebuffer[t].length;r++)e.deleteFramebuffer(n.__webglFramebuffer[t][r]);else e.deleteFramebuffer(n.__webglFramebuffer[t]);n.__webglDepthbuffer&&e.deleteRenderbuffer(n.__webglDepthbuffer[t])}else{if(Array.isArray(n.__webglFramebuffer))for(let t=0;t<n.__webglFramebuffer.length;t++)e.deleteFramebuffer(n.__webglFramebuffer[t]);else e.deleteFramebuffer(n.__webglFramebuffer);if(n.__webglDepthbuffer&&e.deleteRenderbuffer(n.__webglDepthbuffer),n.__webglMultisampledFramebuffer&&e.deleteFramebuffer(n.__webglMultisampledFramebuffer),n.__webglColorRenderbuffer)for(let t=0;t<n.__webglColorRenderbuffer.length;t++)n.__webglColorRenderbuffer[t]&&e.deleteRenderbuffer(n.__webglColorRenderbuffer[t]);n.__webglDepthRenderbuffer&&e.deleteRenderbuffer(n.__webglDepthRenderbuffer)}let i=t.textures;for(let t=0,n=i.length;t<n;t++){let n=r.get(i[t]);n.__webglTexture&&(e.deleteTexture(n.__webglTexture),o.memory.textures--),r.remove(i[t])}r.remove(t)}let O=0;function k(){O=0}function A(){return O}function j(e){O=e}function M(){let e=O;return e>=i.maxTextures&&G(`WebGLTextures: Trying to use `+(e+1)+` texture units while this GPU supports only `+i.maxTextures),O+=1,e}function N(e){let t=[];return t.push(e.wrapS),t.push(e.wrapT),t.push(e.wrapR||0),t.push(e.magFilter),t.push(e.minFilter),t.push(e.anisotropy),t.push(e.internalFormat),t.push(e.format),t.push(e.type),t.push(e.generateMipmaps),t.push(e.premultiplyAlpha),t.push(e.flipY),t.push(e.unpackAlignment),t.push(e.colorSpace),t.join()}function ee(t,i){let a=r.get(t);if(t.isVideoTexture&&xe(t),t.isRenderTargetTexture===!1&&t.isExternalTexture!==!0&&t.version>0&&a.__version!==t.version){let e=t.image;if(e===null)G(`WebGLRenderer: Texture marked for update but no image data found.`);else if(e.complete===!1)G(`WebGLRenderer: Texture marked for update but image is incomplete`);else{ce(a,t,i);return}}else t.isExternalTexture&&(a.__webglTexture=t.sourceTexture?t.sourceTexture:null);n.bindTexture(e.TEXTURE_2D,a.__webglTexture,e.TEXTURE0+i)}function P(t,i){let a=r.get(t);if(t.isRenderTargetTexture===!1&&t.version>0&&a.__version!==t.version){ce(a,t,i);return}t.isExternalTexture&&(a.__webglTexture=t.sourceTexture?t.sourceTexture:null),n.bindTexture(e.TEXTURE_2D_ARRAY,a.__webglTexture,e.TEXTURE0+i)}function te(t,i){let a=r.get(t);if(t.isRenderTargetTexture===!1&&t.version>0&&a.__version!==t.version){ce(a,t,i);return}n.bindTexture(e.TEXTURE_3D,a.__webglTexture,e.TEXTURE0+i)}function ne(t,i){let a=r.get(t);if(t.isCubeDepthTexture!==!0&&t.version>0&&a.__version!==t.version){le(a,t,i);return}n.bindTexture(e.TEXTURE_CUBE_MAP,a.__webglTexture,e.TEXTURE0+i)}let re={[Ge]:e.REPEAT,[Rt]:e.CLAMP_TO_EDGE,[mt]:e.MIRRORED_REPEAT},ie={[tt]:e.NEAREST,[Tt]:e.NEAREST_MIPMAP_NEAREST,[Me]:e.NEAREST_MIPMAP_LINEAR,[cn]:e.LINEAR,[lt]:e.LINEAR_MIPMAP_NEAREST,[Fe]:e.LINEAR_MIPMAP_LINEAR},ae={512:e.NEVER,519:e.ALWAYS,513:e.LESS,515:e.LEQUAL,514:e.EQUAL,518:e.GEQUAL,516:e.GREATER,517:e.NOTEQUAL};function F(n,a){if(a.type===1015&&t.has(`OES_texture_float_linear`)===!1&&(a.magFilter===1006||a.magFilter===1007||a.magFilter===1005||a.magFilter===1008||a.minFilter===1006||a.minFilter===1007||a.minFilter===1005||a.minFilter===1008)&&G(`WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device.`),e.texParameteri(n,e.TEXTURE_WRAP_S,re[a.wrapS]),e.texParameteri(n,e.TEXTURE_WRAP_T,re[a.wrapT]),(n===e.TEXTURE_3D||n===e.TEXTURE_2D_ARRAY)&&e.texParameteri(n,e.TEXTURE_WRAP_R,re[a.wrapR]),e.texParameteri(n,e.TEXTURE_MAG_FILTER,ie[a.magFilter]),e.texParameteri(n,e.TEXTURE_MIN_FILTER,ie[a.minFilter]),a.compareFunction&&(e.texParameteri(n,e.TEXTURE_COMPARE_MODE,e.COMPARE_REF_TO_TEXTURE),e.texParameteri(n,e.TEXTURE_COMPARE_FUNC,ae[a.compareFunction])),t.has(`EXT_texture_filter_anisotropic`)===!0){if(a.magFilter===1003||a.minFilter!==1005&&a.minFilter!==1008||a.type===1015&&t.has(`OES_texture_float_linear`)===!1)return;if(a.anisotropy>1||r.get(a).__currentAnisotropy){let o=t.get(`EXT_texture_filter_anisotropic`);e.texParameterf(n,o.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(a.anisotropy,i.getMaxAnisotropy())),r.get(a).__currentAnisotropy=a.anisotropy}}}function oe(t,n){let r=!1;t.__webglInit===void 0&&(t.__webglInit=!0,n.addEventListener(`dispose`,C));let i=n.source,a=p.get(i);a===void 0&&(a={},p.set(i,a));let s=N(n);if(s!==t.__cacheKey){a[s]===void 0&&(a[s]={texture:e.createTexture(),usedTimes:0},o.memory.textures++,r=!0),a[s].usedTimes++;let i=a[t.__cacheKey];i!==void 0&&(a[t.__cacheKey].usedTimes--,i.usedTimes===0&&E(n)),t.__cacheKey=s,t.__webglTexture=a[s].texture}return r}function I(e,t,n){return Math.floor(Math.floor(e/n)/t)}function se(t,r,i,a){let o=t.updateRanges;if(o.length===0)n.texSubImage2D(e.TEXTURE_2D,0,0,0,r.width,r.height,i,a,r.data);else{o.sort((e,t)=>e.start-t.start);let s=0;for(let e=1;e<o.length;e++){let t=o[s],n=o[e],i=t.start+t.count,a=I(n.start,r.width,4),c=I(t.start,r.width,4);n.start<=i+1&&a===c&&I(n.start+n.count-1,r.width,4)===a?t.count=Math.max(t.count,n.start+n.count-t.start):(++s,o[s]=n)}o.length=s+1;let c=n.getParameter(e.UNPACK_ROW_LENGTH),l=n.getParameter(e.UNPACK_SKIP_PIXELS),u=n.getParameter(e.UNPACK_SKIP_ROWS);n.pixelStorei(e.UNPACK_ROW_LENGTH,r.width);for(let t=0,s=o.length;t<s;t++){let s=o[t],c=Math.floor(s.start/4),l=Math.ceil(s.count/4),u=c%r.width,d=Math.floor(c/r.width),f=l;n.pixelStorei(e.UNPACK_SKIP_PIXELS,u),n.pixelStorei(e.UNPACK_SKIP_ROWS,d),n.texSubImage2D(e.TEXTURE_2D,0,u,d,f,1,i,a,r.data)}t.clearUpdateRanges(),n.pixelStorei(e.UNPACK_ROW_LENGTH,c),n.pixelStorei(e.UNPACK_SKIP_PIXELS,l),n.pixelStorei(e.UNPACK_SKIP_ROWS,u)}}function ce(t,o,s){let c=e.TEXTURE_2D;(o.isDataArrayTexture||o.isCompressedArrayTexture)&&(c=e.TEXTURE_2D_ARRAY),o.isData3DTexture&&(c=e.TEXTURE_3D);let l=oe(t,o),u=o.source;n.bindTexture(c,t.__webglTexture,e.TEXTURE0+s);let f=r.get(u);if(u.version!==f.__version||l===!0){if(n.activeTexture(e.TEXTURE0+s),!(typeof ImageBitmap<`u`&&o.image instanceof ImageBitmap)){let t=Ct.getPrimaries(Ct.workingColorSpace),r=o.colorSpace===``?null:Ct.getPrimaries(o.colorSpace),i=o.colorSpace===``||t===r?e.NONE:e.BROWSER_DEFAULT_WEBGL;n.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,o.flipY),n.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,o.premultiplyAlpha),n.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,i)}n.pixelStorei(e.UNPACK_ALIGNMENT,o.unpackAlignment);let t=g(o.image,!1,i.maxTextureSize);t=R(o,t);let r=a.convert(o.format,o.colorSpace),p=a.convert(o.type),m=b(o.internalFormat,r,p,o.normalized,o.colorSpace,o.isVideoTexture);F(c,o);let h,y=o.mipmaps,C=o.isVideoTexture!==!0,w=f.__version===void 0||l===!0,T=u.dataReady,E=S(o,t);if(o.isDepthTexture)m=x(o.format===rt,o.type),w&&(C?n.texStorage2D(e.TEXTURE_2D,1,m,t.width,t.height):n.texImage2D(e.TEXTURE_2D,0,m,t.width,t.height,0,r,p,null));else if(o.isDataTexture){if(y.length>0){C&&w&&n.texStorage2D(e.TEXTURE_2D,E,m,y[0].width,y[0].height);for(let t=0,i=y.length;t<i;t++)h=y[t],C?T&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,p,h.data):n.texImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,r,p,h.data);o.generateMipmaps=!1}else C?(w&&n.texStorage2D(e.TEXTURE_2D,E,m,t.width,t.height),T&&se(o,t,r,p)):n.texImage2D(e.TEXTURE_2D,0,m,t.width,t.height,0,r,p,t.data)}else if(o.isCompressedTexture){if(o.isCompressedArrayTexture){C&&w&&n.texStorage3D(e.TEXTURE_2D_ARRAY,E,m,y[0].width,y[0].height,t.depth);for(let i=0,a=y.length;i<a;i++)if(h=y[i],o.format!==1023){if(r!==null){if(C){if(T){if(o.layerUpdates.size>0){let t=$e(h.width,h.height,o.format,o.type);for(let a of o.layerUpdates){let o=h.data.subarray(a*t/h.data.BYTES_PER_ELEMENT,(a+1)*t/h.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,a,h.width,h.height,1,r,o)}}else n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,0,h.width,h.height,t.depth,r,h.data)}}else n.compressedTexImage3D(e.TEXTURE_2D_ARRAY,i,m,h.width,h.height,t.depth,0,h.data,0,0)}else G(`WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()`)}else C?T&&n.texSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,0,h.width,h.height,t.depth,r,p,h.data):n.texImage3D(e.TEXTURE_2D_ARRAY,i,m,h.width,h.height,t.depth,0,r,p,h.data);o.layerUpdates.size>0&&o.clearLayerUpdates()}else{C&&w&&n.texStorage2D(e.TEXTURE_2D,E,m,y[0].width,y[0].height);for(let t=0,i=y.length;t<i;t++)h=y[t],o.format===1023?C?T&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,p,h.data):n.texImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,r,p,h.data):r===null?G(`WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()`):C?T&&n.compressedTexSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,h.data):n.compressedTexImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,h.data)}}else if(o.isDataArrayTexture){if(C){if(w&&n.texStorage3D(e.TEXTURE_2D_ARRAY,E,m,t.width,t.height,t.depth),T){if(o.layerUpdates.size>0){let i=$e(t.width,t.height,o.format,o.type);for(let a of o.layerUpdates){let o=t.data.subarray(a*i/t.data.BYTES_PER_ELEMENT,(a+1)*i/t.data.BYTES_PER_ELEMENT);n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,a,t.width,t.height,1,r,p,o)}o.clearLayerUpdates()}else n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,0,t.width,t.height,t.depth,r,p,t.data)}}else n.texImage3D(e.TEXTURE_2D_ARRAY,0,m,t.width,t.height,t.depth,0,r,p,t.data)}else if(o.isData3DTexture)C?(w&&n.texStorage3D(e.TEXTURE_3D,E,m,t.width,t.height,t.depth),T&&n.texSubImage3D(e.TEXTURE_3D,0,0,0,0,t.width,t.height,t.depth,r,p,t.data)):n.texImage3D(e.TEXTURE_3D,0,m,t.width,t.height,t.depth,0,r,p,t.data);else if(o.isFramebufferTexture){if(w){if(C)n.texStorage2D(e.TEXTURE_2D,E,m,t.width,t.height);else{let i=t.width,a=t.height;for(let t=0;t<E;t++)n.texImage2D(e.TEXTURE_2D,t,m,i,a,0,r,p,null),i>>=1,a>>=1}}}else if(o.isHTMLTexture){if(`texElementImage2D`in e){let n=e.canvas;if(n.hasAttribute(`layoutsubtree`)||n.setAttribute(`layoutsubtree`,`true`),t.parentNode!==n){n.appendChild(t),d.add(o),n.onpaint=e=>{let t=e.changedElements;for(let e of d)t.includes(e.image)&&(e.needsUpdate=!0)},n.requestPaint();return}if(e.texElementImage2D.length===3)e.texElementImage2D(e.TEXTURE_2D,e.RGBA8,t);else{let n=e.RGBA,r=e.RGBA,i=e.UNSIGNED_BYTE;e.texElementImage2D(e.TEXTURE_2D,0,n,r,i,t)}e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}}else if(y.length>0){if(C&&w){let t=Se(y[0]);n.texStorage2D(e.TEXTURE_2D,E,m,t.width,t.height)}for(let t=0,i=y.length;t<i;t++)h=y[t],C?T&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,r,p,h):n.texImage2D(e.TEXTURE_2D,t,m,r,p,h);o.generateMipmaps=!1}else if(C){if(w){let r=Se(t);n.texStorage2D(e.TEXTURE_2D,E,m,r.width,r.height)}T&&n.texSubImage2D(e.TEXTURE_2D,0,0,0,r,p,t)}else n.texImage2D(e.TEXTURE_2D,0,m,r,p,t);_(o)&&v(c),f.__version=u.version,o.onUpdate&&o.onUpdate(o)}t.__version=o.version}function le(t,o,s){if(o.image.length!==6)return;let c=oe(t,o),l=o.source;n.bindTexture(e.TEXTURE_CUBE_MAP,t.__webglTexture,e.TEXTURE0+s);let u=r.get(l);if(l.version!==u.__version||c===!0){n.activeTexture(e.TEXTURE0+s);let t=Ct.getPrimaries(Ct.workingColorSpace),r=o.colorSpace===``?null:Ct.getPrimaries(o.colorSpace),d=o.colorSpace===``||t===r?e.NONE:e.BROWSER_DEFAULT_WEBGL;n.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,o.flipY),n.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,o.premultiplyAlpha),n.pixelStorei(e.UNPACK_ALIGNMENT,o.unpackAlignment),n.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,d);let f=o.isCompressedTexture||o.image[0].isCompressedTexture,p=o.image[0]&&o.image[0].isDataTexture,m=[];for(let e=0;e<6;e++)!f&&!p?m[e]=g(o.image[e],!0,i.maxCubemapSize):m[e]=p?o.image[e].image:o.image[e],m[e]=R(o,m[e]);let h=m[0],y=a.convert(o.format,o.colorSpace),x=a.convert(o.type),C=b(o.internalFormat,y,x,o.normalized,o.colorSpace),w=o.isVideoTexture!==!0,T=u.__version===void 0||c===!0,E=l.dataReady,D=S(o,h);F(e.TEXTURE_CUBE_MAP,o);let O;if(f){w&&T&&n.texStorage2D(e.TEXTURE_CUBE_MAP,D,C,h.width,h.height);for(let t=0;t<6;t++){O=m[t].mipmaps;for(let r=0;r<O.length;r++){let i=O[r];o.format===1023?w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,0,0,i.width,i.height,y,x,i.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,C,i.width,i.height,0,y,x,i.data):y===null?G(`WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()`):w?E&&n.compressedTexSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,0,0,i.width,i.height,y,i.data):n.compressedTexImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,C,i.width,i.height,0,i.data)}}}else{if(O=o.mipmaps,w&&T){O.length>0&&D++;let t=Se(m[0]);n.texStorage2D(e.TEXTURE_CUBE_MAP,D,C,t.width,t.height)}for(let t=0;t<6;t++)if(p){w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,0,0,m[t].width,m[t].height,y,x,m[t].data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,C,m[t].width,m[t].height,0,y,x,m[t].data);for(let r=0;r<O.length;r++){let i=O[r].image[t].image;w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,0,0,i.width,i.height,y,x,i.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,C,i.width,i.height,0,y,x,i.data)}}else{w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,0,0,y,x,m[t]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,C,y,x,m[t]);for(let r=0;r<O.length;r++){let i=O[r];w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,0,0,y,x,i.image[t]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,C,y,x,i.image[t])}}}_(o)&&v(e.TEXTURE_CUBE_MAP),u.__version=l.version,o.onUpdate&&o.onUpdate(o)}t.__version=o.version}function ue(t,i,o,c,l,u){let d=a.convert(o.format,o.colorSpace),f=a.convert(o.type),p=b(o.internalFormat,d,f,o.normalized,o.colorSpace),m=r.get(i),h=r.get(o);if(h.__renderTarget=i,!m.__hasExternalTextures){let t=Math.max(1,i.width>>u),r=Math.max(1,i.height>>u);l===e.TEXTURE_3D||l===e.TEXTURE_2D_ARRAY?n.texImage3D(l,u,p,t,r,i.depth,0,d,f,null):n.texImage2D(l,u,p,t,r,0,d,f,null)}n.bindFramebuffer(e.FRAMEBUFFER,t),L(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,c,l,h.__webglTexture,0,be(i)):(l===e.TEXTURE_2D||l>=e.TEXTURE_CUBE_MAP_POSITIVE_X&&l<=e.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&e.framebufferTexture2D(e.FRAMEBUFFER,c,l,h.__webglTexture,u),n.bindFramebuffer(e.FRAMEBUFFER,null)}function de(t,n,r){if(e.bindRenderbuffer(e.RENDERBUFFER,t),n.depthBuffer){let i=n.depthTexture,a=i&&i.isDepthTexture?i.type:null,o=x(n.stencilBuffer,a),c=n.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;L(n)?s.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,be(n),o,n.width,n.height):r?e.renderbufferStorageMultisample(e.RENDERBUFFER,be(n),o,n.width,n.height):e.renderbufferStorage(e.RENDERBUFFER,o,n.width,n.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,c,e.RENDERBUFFER,t)}else{let t=n.textures;for(let i=0;i<t.length;i++){let o=t[i],c=a.convert(o.format,o.colorSpace),l=a.convert(o.type),u=b(o.internalFormat,c,l,o.normalized,o.colorSpace);L(n)?s.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,be(n),u,n.width,n.height):r?e.renderbufferStorageMultisample(e.RENDERBUFFER,be(n),u,n.width,n.height):e.renderbufferStorage(e.RENDERBUFFER,u,n.width,n.height)}}e.bindRenderbuffer(e.RENDERBUFFER,null)}function fe(t,i,o){let c=i.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(e.FRAMEBUFFER,t),!(i.depthTexture&&i.depthTexture.isDepthTexture))throw Error(`THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.`);let l=r.get(i.depthTexture);if(l.__renderTarget=i,(!l.__webglTexture||i.depthTexture.image.width!==i.width||i.depthTexture.image.height!==i.height)&&(i.depthTexture.image.width=i.width,i.depthTexture.image.height=i.height,i.depthTexture.needsUpdate=!0),c){if(l.__webglInit===void 0&&(l.__webglInit=!0,i.depthTexture.addEventListener(`dispose`,C)),l.__webglTexture===void 0){l.__webglTexture=e.createTexture(),n.bindTexture(e.TEXTURE_CUBE_MAP,l.__webglTexture),F(e.TEXTURE_CUBE_MAP,i.depthTexture);let t=a.convert(i.depthTexture.format),r=a.convert(i.depthTexture.type),o;i.depthTexture.format===1026?o=e.DEPTH_COMPONENT24:i.depthTexture.format===1027&&(o=e.DEPTH24_STENCIL8);for(let n=0;n<6;n++)e.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+n,0,o,i.width,i.height,0,t,r,null)}}else ee(i.depthTexture,0);let u=l.__webglTexture,d=be(i),f=c?e.TEXTURE_CUBE_MAP_POSITIVE_X+o:e.TEXTURE_2D,p=i.depthTexture.format===1027?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;if(i.depthTexture.format===1026)L(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,u,0,d):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,u,0);else if(i.depthTexture.format===1027)L(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,u,0,d):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,u,0);else throw Error(`THREE.WebGLTextures: Unknown depthTexture format.`)}function pe(t){let i=r.get(t),a=t.isWebGLCubeRenderTarget===!0;if(i.__boundDepthTexture!==t.depthTexture){let e=t.depthTexture;if(i.__depthDisposeCallback&&i.__depthDisposeCallback(),e){let t=()=>{delete i.__boundDepthTexture,delete i.__depthDisposeCallback,e.removeEventListener(`dispose`,t)};e.addEventListener(`dispose`,t),i.__depthDisposeCallback=t}i.__boundDepthTexture=e}if(t.depthTexture&&!i.__autoAllocateDepthBuffer){if(a)for(let e=0;e<6;e++)fe(i.__webglFramebuffer[e],t,e);else{let e=t.texture.mipmaps;e&&e.length>0?fe(i.__webglFramebuffer[0],t,0):fe(i.__webglFramebuffer,t,0)}}else if(a){i.__webglDepthbuffer=[];for(let r=0;r<6;r++)if(n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[r]),i.__webglDepthbuffer[r]===void 0)i.__webglDepthbuffer[r]=e.createRenderbuffer(),de(i.__webglDepthbuffer[r],t,!1);else{let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,a=i.__webglDepthbuffer[r];e.bindRenderbuffer(e.RENDERBUFFER,a),e.framebufferRenderbuffer(e.FRAMEBUFFER,n,e.RENDERBUFFER,a)}}else{let r=t.texture.mipmaps;if(r&&r.length>0?n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[0]):n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer),i.__webglDepthbuffer===void 0)i.__webglDepthbuffer=e.createRenderbuffer(),de(i.__webglDepthbuffer,t,!1);else{let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,r=i.__webglDepthbuffer;e.bindRenderbuffer(e.RENDERBUFFER,r),e.framebufferRenderbuffer(e.FRAMEBUFFER,n,e.RENDERBUFFER,r)}}n.bindFramebuffer(e.FRAMEBUFFER,null)}function me(t,n,i){let a=r.get(t);n!==void 0&&ue(a.__webglFramebuffer,t,t.texture,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,0),i!==void 0&&pe(t)}function he(t){let i=t.texture,s=r.get(t),c=r.get(i);t.addEventListener(`dispose`,w);let l=t.textures,u=t.isWebGLCubeRenderTarget===!0,d=l.length>1;if(d||(c.__webglTexture===void 0&&(c.__webglTexture=e.createTexture()),c.__version=i.version,o.memory.textures++),u){s.__webglFramebuffer=[];for(let t=0;t<6;t++)if(i.mipmaps&&i.mipmaps.length>0){s.__webglFramebuffer[t]=[];for(let n=0;n<i.mipmaps.length;n++)s.__webglFramebuffer[t][n]=e.createFramebuffer()}else s.__webglFramebuffer[t]=e.createFramebuffer()}else{if(i.mipmaps&&i.mipmaps.length>0){s.__webglFramebuffer=[];for(let t=0;t<i.mipmaps.length;t++)s.__webglFramebuffer[t]=e.createFramebuffer()}else s.__webglFramebuffer=e.createFramebuffer();if(d)for(let t=0,n=l.length;t<n;t++){let n=r.get(l[t]);n.__webglTexture===void 0&&(n.__webglTexture=e.createTexture(),o.memory.textures++)}if(t.samples>0&&L(t)===!1){s.__webglMultisampledFramebuffer=e.createFramebuffer(),s.__webglColorRenderbuffer=[],n.bindFramebuffer(e.FRAMEBUFFER,s.__webglMultisampledFramebuffer);for(let n=0;n<l.length;n++){let r=l[n];s.__webglColorRenderbuffer[n]=e.createRenderbuffer(),e.bindRenderbuffer(e.RENDERBUFFER,s.__webglColorRenderbuffer[n]);let i=a.convert(r.format,r.colorSpace),o=a.convert(r.type),c=b(r.internalFormat,i,o,r.normalized,r.colorSpace,t.isXRRenderTarget===!0),u=be(t);e.renderbufferStorageMultisample(e.RENDERBUFFER,u,c,t.width,t.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+n,e.RENDERBUFFER,s.__webglColorRenderbuffer[n])}e.bindRenderbuffer(e.RENDERBUFFER,null),t.depthBuffer&&(s.__webglDepthRenderbuffer=e.createRenderbuffer(),de(s.__webglDepthRenderbuffer,t,!0)),n.bindFramebuffer(e.FRAMEBUFFER,null)}}if(u){n.bindTexture(e.TEXTURE_CUBE_MAP,c.__webglTexture),F(e.TEXTURE_CUBE_MAP,i);for(let n=0;n<6;n++)if(i.mipmaps&&i.mipmaps.length>0)for(let r=0;r<i.mipmaps.length;r++)ue(s.__webglFramebuffer[n][r],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+n,r);else ue(s.__webglFramebuffer[n],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+n,0);_(i)&&v(e.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(d){for(let i=0,a=l.length;i<a;i++){let a=l[i],o=r.get(a),c=e.TEXTURE_2D;(t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(c=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(c,o.__webglTexture),F(c,a),ue(s.__webglFramebuffer,t,a,e.COLOR_ATTACHMENT0+i,c,0),_(a)&&v(c)}n.unbindTexture()}else{let r=e.TEXTURE_2D;if((t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(r=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(r,c.__webglTexture),F(r,i),i.mipmaps&&i.mipmaps.length>0)for(let n=0;n<i.mipmaps.length;n++)ue(s.__webglFramebuffer[n],t,i,e.COLOR_ATTACHMENT0,r,n);else ue(s.__webglFramebuffer,t,i,e.COLOR_ATTACHMENT0,r,0);_(i)&&v(r),n.unbindTexture()}t.depthBuffer&&pe(t)}function ge(e){let t=e.textures;for(let i=0,a=t.length;i<a;i++){let a=t[i];if(_(a)){let t=y(e),i=r.get(a).__webglTexture;n.bindTexture(t,i),v(t),n.unbindTexture()}}}let _e=[],ve=[];function ye(t){if(t.samples>0){if(L(t)===!1){let i=t.textures,a=t.width,o=t.height,s=e.COLOR_BUFFER_BIT,l=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,u=r.get(t),d=i.length>1;if(d)for(let t=0;t<i.length;t++)n.bindFramebuffer(e.FRAMEBUFFER,u.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,null),n.bindFramebuffer(e.FRAMEBUFFER,u.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,null,0);n.bindFramebuffer(e.READ_FRAMEBUFFER,u.__webglMultisampledFramebuffer);let f=t.texture.mipmaps;f&&f.length>0?n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglFramebuffer[0]):n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglFramebuffer);for(let n=0;n<i.length;n++){if(t.resolveDepthBuffer&&(t.depthBuffer&&(s|=e.DEPTH_BUFFER_BIT),t.stencilBuffer&&t.resolveStencilBuffer&&(s|=e.STENCIL_BUFFER_BIT)),d){e.framebufferRenderbuffer(e.READ_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.RENDERBUFFER,u.__webglColorRenderbuffer[n]);let t=r.get(i[n]).__webglTexture;e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,t,0)}e.blitFramebuffer(0,0,a,o,0,0,a,o,s,e.NEAREST),c===!0&&(_e.length=0,ve.length=0,_e.push(e.COLOR_ATTACHMENT0+n),t.depthBuffer&&t.storeMultisampledDepthBuffer===!1&&(_e.push(l),ve.push(l),e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,ve)),e.invalidateFramebuffer(e.READ_FRAMEBUFFER,_e))}if(n.bindFramebuffer(e.READ_FRAMEBUFFER,null),n.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),d)for(let t=0;t<i.length;t++){n.bindFramebuffer(e.FRAMEBUFFER,u.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,u.__webglColorRenderbuffer[t]);let a=r.get(i[t]).__webglTexture;n.bindFramebuffer(e.FRAMEBUFFER,u.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,a,0)}n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglMultisampledFramebuffer)}else if(t.depthBuffer&&t.storeMultisampledDepthBuffer===!1&&c){let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,[n])}}}function be(e){return Math.min(i.maxSamples,e.samples)}function L(e){let n=r.get(e);return e.samples>0&&t.has(`WEBGL_multisampled_render_to_texture`)===!0&&n.__useRenderToTexture!==!1}function xe(e){let t=o.render.frame;u.get(e)!==t&&(u.set(e,t),e.update())}function R(e,t){let n=e.colorSpace,r=e.format,i=e.type;return e.isCompressedTexture===!0||e.isVideoTexture===!0||n!==`srgb-linear`&&n!==``&&(Ct.getTransfer(n)===`srgb`?(r!==1023||i!==1009)&&G(`WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType.`):U(`WebGLTextures: Unsupported texture color space:`,n)),t}function Se(e){return typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement?(l.width=e.naturalWidth||e.width,l.height=e.naturalHeight||e.height):typeof VideoFrame<`u`&&e instanceof VideoFrame?(l.width=e.displayWidth,l.height=e.displayHeight):(l.width=e.width,l.height=e.height),l}this.allocateTextureUnit=M,this.resetTextureUnits=k,this.getTextureUnits=A,this.setTextureUnits=j,this.setTexture2D=ee,this.setTexture2DArray=P,this.setTexture3D=te,this.setTextureCube=ne,this.rebindTextures=me,this.setupRenderTarget=he,this.updateRenderTargetMipmap=ge,this.updateMultisampleRenderTarget=ye,this.setupDepthRenderbuffer=pe,this.setupFrameBufferTexture=ue,this.useMultisampledRTT=L,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function Pa(e,t){function n(n,r=``){let i,a=Ct.getTransfer(r);if(n===1009)return e.UNSIGNED_BYTE;if(n===1017)return e.UNSIGNED_SHORT_4_4_4_4;if(n===1018)return e.UNSIGNED_SHORT_5_5_5_1;if(n===35902)return e.UNSIGNED_INT_5_9_9_9_REV;if(n===35899)return e.UNSIGNED_INT_10F_11F_11F_REV;if(n===1010)return e.BYTE;if(n===1011)return e.SHORT;if(n===1012)return e.UNSIGNED_SHORT;if(n===1013)return e.INT;if(n===1014)return e.UNSIGNED_INT;if(n===1015)return e.FLOAT;if(n===1016)return e.HALF_FLOAT;if(n===1021)return e.ALPHA;if(n===1022)return e.RGB;if(n===1023)return e.RGBA;if(n===1026)return e.DEPTH_COMPONENT;if(n===1027)return e.DEPTH_STENCIL;if(n===1028)return e.RED;if(n===1029)return e.RED_INTEGER;if(n===1030)return e.RG;if(n===1031)return e.RG_INTEGER;if(n===1033)return e.RGBA_INTEGER;if(n===33776||n===33777||n===33778||n===33779){if(a===`srgb`){if(i=t.get(`WEBGL_compressed_texture_s3tc_srgb`),i!==null){if(n===33776)return i.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===33777)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===33778)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===33779)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null}else if(i=t.get(`WEBGL_compressed_texture_s3tc`),i!==null){if(n===33776)return i.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===33777)return i.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===33778)return i.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===33779)return i.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null}if(n===35840||n===35841||n===35842||n===35843){if(i=t.get(`WEBGL_compressed_texture_pvrtc`),i!==null){if(n===35840)return i.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===35841)return i.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===35842)return i.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===35843)return i.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null}if(n===36196||n===37492||n===37496||n===37488||n===37489||n===37490||n===37491){if(i=t.get(`WEBGL_compressed_texture_etc`),i!==null){if(n===36196||n===37492)return a===`srgb`?i.COMPRESSED_SRGB8_ETC2:i.COMPRESSED_RGB8_ETC2;if(n===37496)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:i.COMPRESSED_RGBA8_ETC2_EAC;if(n===37488)return i.COMPRESSED_R11_EAC;if(n===37489)return i.COMPRESSED_SIGNED_R11_EAC;if(n===37490)return i.COMPRESSED_RG11_EAC;if(n===37491)return i.COMPRESSED_SIGNED_RG11_EAC}else return null}if(n===37808||n===37809||n===37810||n===37811||n===37812||n===37813||n===37814||n===37815||n===37816||n===37817||n===37818||n===37819||n===37820||n===37821){if(i=t.get(`WEBGL_compressed_texture_astc`),i!==null){if(n===37808)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:i.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===37809)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:i.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===37810)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:i.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===37811)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:i.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===37812)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:i.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===37813)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:i.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===37814)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:i.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===37815)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:i.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===37816)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:i.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===37817)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:i.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===37818)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:i.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===37819)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:i.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===37820)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:i.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===37821)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:i.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null}if(n===36492||n===36494||n===36495){if(i=t.get(`EXT_texture_compression_bptc`),i!==null){if(n===36492)return a===`srgb`?i.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:i.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===36494)return i.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===36495)return i.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null}if(n===36283||n===36284||n===36285||n===36286){if(i=t.get(`EXT_texture_compression_rgtc`),i!==null){if(n===36283)return i.COMPRESSED_RED_RGTC1_EXT;if(n===36284)return i.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===36285)return i.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===36286)return i.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null}return n===1020?e.UNSIGNED_INT_24_8:e[n]===void 0?null:e[n]}return{convert:n}}var Fa=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Ia=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,La=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new at(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new J({vertexShader:Fa,fragmentShader:Ia,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new q(new vt(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Ra=class extends nn{constructor(e,t){super();let n=this,r=null,i=1,a=null,o=`local-floor`,s=1,c=null,l=null,u=null,d=null,f=null,p=null,m=typeof XRWebGLBinding<`u`,h=new La,g={},_=t.getContextAttributes(),v=null,y=null,b=[],x=[],S=new X,C=null,w=null,T=new Xt;T.viewport=new K;let E=new Xt;E.viewport=new K;let D=[T,E],O=new Ht,k=null,A=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(e){let t=b[e];return t===void 0&&(t=new Le,b[e]=t),t.getTargetRaySpace()},this.getControllerGrip=function(e){let t=b[e];return t===void 0&&(t=new Le,b[e]=t),t.getGripSpace()},this.getHand=function(e){let t=b[e];return t===void 0&&(t=new Le,b[e]=t),t.getHandSpace()};function j(e){let t=x.indexOf(e.inputSource);if(t===-1)return;let n=b[t];n!==void 0&&(n.update(e.inputSource,e.frame,c||a),n.dispatchEvent({type:e.type,data:e.inputSource}))}function M(){r.removeEventListener(`select`,j),r.removeEventListener(`selectstart`,j),r.removeEventListener(`selectend`,j),r.removeEventListener(`squeeze`,j),r.removeEventListener(`squeezestart`,j),r.removeEventListener(`squeezeend`,j),r.removeEventListener(`end`,M),r.removeEventListener(`inputsourceschange`,N);for(let e=0;e<b.length;e++){let t=x[e];t!==null&&(x[e]=null,b[e].disconnect(t))}k=null,A=null,h.reset();for(let e in g)delete g[e];if(e.setRenderTarget(v),f=null,d=null,u=null,r=null,y=null,F.stop(),n.isPresenting=!1,e.setPixelRatio(C),e.setSize(S.width,S.height,!1),w!==null){let e=w.camera;e.fov=w.fov,e.zoom=w.zoom,e.updateProjectionMatrix(),w=null}n.dispatchEvent({type:`sessionend`})}this.setFramebufferScaleFactor=function(e){i=e,n.isPresenting===!0&&G(`WebXRManager: Cannot change framebuffer scale while presenting.`)},this.setReferenceSpaceType=function(e){o=e,n.isPresenting===!0&&G(`WebXRManager: Cannot change reference space type while presenting.`)},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(e){c=e},this.getBaseLayer=function(){return d===null?f:d},this.getBinding=function(){return u===null&&m&&(u=new XRWebGLBinding(r,t)),u},this.getFrame=function(){return p},this.getSession=function(){return r},this.setSession=async function(l){if(r=l,r!==null){if(v=e.getRenderTarget(),r.addEventListener(`select`,j),r.addEventListener(`selectstart`,j),r.addEventListener(`selectend`,j),r.addEventListener(`squeeze`,j),r.addEventListener(`squeezestart`,j),r.addEventListener(`squeezeend`,j),r.addEventListener(`end`,M),r.addEventListener(`inputsourceschange`,N),_.xrCompatible!==!0&&await t.makeXRCompatible(),C=e.getPixelRatio(),e.getSize(S),m&&`createProjectionLayer`in XRWebGLBinding.prototype){let n=null,a=null,o=null;_.depth&&(o=_.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,n=_.stencil?rt:an,a=_.stencil?Et:Vt);let s={colorFormat:t.RGBA8,depthFormat:o,scaleFactor:i};u=this.getBinding(),d=u.createProjectionLayer(s),r.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),y=new it(d.textureWidth,d.textureHeight,{format:Dt,type:en,depthTexture:new Ie(d.textureWidth,d.textureHeight,a,void 0,void 0,void 0,void 0,void 0,void 0,n),stencilBuffer:_.stencil,colorSpace:e.outputColorSpace,samples:_.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1,storeMultisampledDepthBuffer:d.ignoreDepthValues===!1,storeMultisampledStencilBuffer:d.ignoreDepthValues===!1})}else{let n={antialias:_.antialias,alpha:!0,depth:_.depth,stencil:_.stencil,framebufferScaleFactor:i};f=new XRWebGLLayer(r,t,n),r.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),y=new it(f.framebufferWidth,f.framebufferHeight,{format:Dt,type:en,colorSpace:e.outputColorSpace,stencilBuffer:_.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1,storeMultisampledDepthBuffer:f.ignoreDepthValues===!1,storeMultisampledStencilBuffer:f.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(s),c=null,a=await r.requestReferenceSpace(o),F.setContext(r),F.start(),n.isPresenting=!0,n.dispatchEvent({type:`sessionstart`})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return h.getDepthTexture()};function N(e){for(let t=0;t<e.removed.length;t++){let n=e.removed[t],r=x.indexOf(n);r>=0&&(x[r]=null,b[r].disconnect(n))}for(let t=0;t<e.added.length;t++){let n=e.added[t],r=x.indexOf(n);if(r===-1){for(let e=0;e<b.length;e++)if(e>=x.length){x.push(n),r=e;break}else if(x[e]===null){x[e]=n,r=e;break}if(r===-1)break}let i=b[r];i&&i.connect(n)}}let ee=new Z,P=new Z;function te(e,t,n){ee.setFromMatrixPosition(t.matrixWorld),P.setFromMatrixPosition(n.matrixWorld);let r=ee.distanceTo(P),i=t.projectionMatrix.elements,a=n.projectionMatrix.elements,o=i[14]/(i[10]-1),s=i[14]/(i[10]+1),c=(i[9]+1)/i[5],l=(i[9]-1)/i[5],u=(i[8]-1)/i[0],d=(a[8]+1)/a[0],f=o*u,p=o*d,m=r/(-u+d),h=m*-u;if(t.matrixWorld.decompose(e.position,e.quaternion,e.scale),e.translateX(h),e.translateZ(m),e.matrixWorld.compose(e.position,e.quaternion,e.scale),e.matrixWorldInverse.copy(e.matrixWorld).invert(),i[10]===-1)e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse);else{let t=o+m,n=s+m,i=f-h,a=p+(r-h),u=c*s/n*t,d=l*s/n*t;e.projectionMatrix.makePerspective(i,a,u,d,t,n),e.projectionMatrixInverse.copy(e.projectionMatrix).invert()}}function ne(e,t){t===null?e.matrixWorld.copy(e.matrix):e.matrixWorld.multiplyMatrices(t.matrixWorld,e.matrix),e.matrixWorldInverse.copy(e.matrixWorld).invert()}this.updateCamera=function(e){if(r===null)return;let t=e.near,n=e.far;h.texture!==null&&(h.depthNear>0&&(t=h.depthNear),h.depthFar>0&&(n=h.depthFar)),O.near=E.near=T.near=t,O.far=E.far=T.far=n,(k!==O.near||A!==O.far)&&(r.updateRenderState({depthNear:O.near,depthFar:O.far}),k=O.near,A=O.far),O.layers.mask=e.layers.mask|6,T.layers.mask=O.layers.mask&-5,E.layers.mask=O.layers.mask&-3;let i=e.parent,a=O.cameras;ne(O,i);for(let e=0;e<a.length;e++)ne(a[e],i);a.length===2?te(O,T,E):O.projectionMatrix.copy(T.projectionMatrix),w===null&&e.isPerspectiveCamera&&(w={camera:e,fov:e.fov,zoom:e.zoom}),re(e,O,i)};function re(e,t,n){n===null?e.matrix.copy(t.matrixWorld):(e.matrix.copy(n.matrixWorld),e.matrix.invert(),e.matrix.multiply(t.matrixWorld)),e.matrix.decompose(e.position,e.quaternion,e.scale),e.updateMatrixWorld(!0),e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse),e.isPerspectiveCamera&&(e.fov=St*2*Math.atan(1/e.projectionMatrix.elements[5]),e.zoom=1)}this.getCamera=function(){return O},this.getFoveation=function(){if(d!==null||f!==null)return s},this.setFoveation=function(e){s=e,d!==null&&(d.fixedFoveation=e),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=e)},this.hasDepthSensing=function(){return h.texture!==null},this.getDepthSensingMesh=function(){return h.getMesh(O)},this.getCameraTexture=function(e){return g[e]};let ie=null;function ae(t,i){if(l=i.getViewerPose(c||a),p=i,l!==null){let t=l.views;f!==null&&(e.setRenderTargetFramebuffer(y,f.framebuffer),e.setRenderTarget(y));let i=!1;t.length!==O.cameras.length&&(O.cameras.length=0,i=!0);for(let n=0;n<t.length;n++){let r=t[n],a=null;if(f!==null)a=f.getViewport(r);else{let t=u.getViewSubImage(d,r);a=t.viewport,n===0&&(e.setRenderTargetTextures(y,t.colorTexture,t.depthStencilTexture),e.setRenderTarget(y))}let o=D[n];o===void 0&&(o=new Xt,o.layers.enable(n),o.viewport=new K,D[n]=o),o.matrix.fromArray(r.transform.matrix),o.matrix.decompose(o.position,o.quaternion,o.scale),o.projectionMatrix.fromArray(r.projectionMatrix),o.projectionMatrixInverse.copy(o.projectionMatrix).invert(),o.viewport.set(a.x,a.y,a.width,a.height),n===0&&(O.matrix.copy(o.matrix),O.matrix.decompose(O.position,O.quaternion,O.scale)),i===!0&&O.cameras.push(o)}let a=r.enabledFeatures;if(a&&a.includes(`depth-sensing`)&&r.depthUsage==`gpu-optimized`&&m){u=n.getBinding();let e=u.getDepthInformation(t[0]);e&&e.isValid&&e.texture&&h.init(e,r.renderState)}if(a&&a.includes(`camera-access`)&&m){e.state.unbindTexture(),u=n.getBinding();for(let e=0;e<t.length;e++){let n=t[e].camera;if(n){let e=g[n];e||(e=new at,g[n]=e);let t=u.getCameraImage(n);e.sourceTexture=t}}}}for(let e=0;e<b.length;e++){let t=x[e],n=b[e];t!==null&&n!==void 0&&n.update(t,i,c||a)}ie&&ie(t,i),i.detectedPlanes&&n.dispatchEvent({type:`planesdetected`,data:i}),p=null}let F=new An;F.setAnimationLoop(ae),this.setAnimationLoop=function(e){ie=e},this.dispose=function(){}}},za=new Ke,Ba=new W;Ba.set(-1,0,0,0,1,0,0,0,1);function Va(e,t){function n(e,t){e.matrixAutoUpdate===!0&&e.updateMatrix(),t.value.copy(e.matrix)}function r(t,n){n.color.getRGB(t.fogColor.value,Lt(e)),n.isFog?(t.fogNear.value=n.near,t.fogFar.value=n.far):n.isFogExp2&&(t.fogDensity.value=n.density)}function i(e,t,n,r,i){t.isNodeMaterial?t.uniformsNeedUpdate=!1:t.isMeshBasicMaterial?a(e,t):t.isMeshLambertMaterial?(a(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshToonMaterial?(a(e,t),d(e,t)):t.isMeshPhongMaterial?(a(e,t),u(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshStandardMaterial?(a(e,t),f(e,t),t.isMeshPhysicalMaterial&&p(e,t,i)):t.isMeshMatcapMaterial?(a(e,t),m(e,t)):t.isMeshDepthMaterial?a(e,t):t.isMeshDistanceMaterial?(a(e,t),h(e,t)):t.isMeshNormalMaterial?a(e,t):t.isLineBasicMaterial?(o(e,t),t.isLineDashedMaterial&&s(e,t)):t.isPointsMaterial?c(e,t,n,r):t.isSpriteMaterial?l(e,t):t.isShadowMaterial?(e.color.value.copy(t.color),e.opacity.value=t.opacity):t.isShaderMaterial&&(t.uniformsNeedUpdate=!1)}function a(e,r){e.opacity.value=r.opacity,r.color&&e.diffuse.value.copy(r.color),r.emissive&&e.emissive.value.copy(r.emissive).multiplyScalar(r.emissiveIntensity),r.map&&(e.map.value=r.map,n(r.map,e.mapTransform)),r.alphaMap&&(e.alphaMap.value=r.alphaMap,n(r.alphaMap,e.alphaMapTransform)),r.bumpMap&&(e.bumpMap.value=r.bumpMap,n(r.bumpMap,e.bumpMapTransform),e.bumpScale.value=r.bumpScale,r.side===1&&(e.bumpScale.value*=-1)),r.normalMap&&(e.normalMap.value=r.normalMap,n(r.normalMap,e.normalMapTransform),e.normalScale.value.copy(r.normalScale),r.side===1&&e.normalScale.value.negate()),r.displacementMap&&(e.displacementMap.value=r.displacementMap,n(r.displacementMap,e.displacementMapTransform),e.displacementScale.value=r.displacementScale,e.displacementBias.value=r.displacementBias),r.emissiveMap&&(e.emissiveMap.value=r.emissiveMap,n(r.emissiveMap,e.emissiveMapTransform)),r.specularMap&&(e.specularMap.value=r.specularMap,n(r.specularMap,e.specularMapTransform)),r.alphaTest>0&&(e.alphaTest.value=r.alphaTest);let i=t.get(r),a=i.envMap,o=i.envMapRotation;a&&(e.envMap.value=a,e.envMapRotation.value.setFromMatrix4(za.makeRotationFromEuler(o)).transpose(),a.isCubeTexture&&a.isRenderTargetTexture===!1&&e.envMapRotation.value.premultiply(Ba),e.reflectivity.value=r.reflectivity,e.ior.value=r.ior,e.refractionRatio.value=r.refractionRatio),r.lightMap&&(e.lightMap.value=r.lightMap,e.lightMapIntensity.value=r.lightMapIntensity,n(r.lightMap,e.lightMapTransform)),r.aoMap&&(e.aoMap.value=r.aoMap,e.aoMapIntensity.value=r.aoMapIntensity,n(r.aoMap,e.aoMapTransform))}function o(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,t.map&&(e.map.value=t.map,n(t.map,e.mapTransform))}function s(e,t){e.dashSize.value=t.dashSize,e.totalSize.value=t.dashSize+t.gapSize,e.scale.value=t.scale}function c(e,t,r,i){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.size.value=t.size*r,e.scale.value=i*.5,t.map&&(e.map.value=t.map,n(t.map,e.uvTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,n(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function l(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.rotation.value=t.rotation,t.map&&(e.map.value=t.map,n(t.map,e.mapTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,n(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function u(e,t){e.specular.value.copy(t.specular),e.shininess.value=Math.max(t.shininess,1e-4)}function d(e,t){t.gradientMap&&(e.gradientMap.value=t.gradientMap)}function f(e,t){e.metalness.value=t.metalness,t.metalnessMap&&(e.metalnessMap.value=t.metalnessMap,n(t.metalnessMap,e.metalnessMapTransform)),e.roughness.value=t.roughness,t.roughnessMap&&(e.roughnessMap.value=t.roughnessMap,n(t.roughnessMap,e.roughnessMapTransform)),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)}function p(e,t,r){e.ior.value=t.ior,t.sheen>0&&(e.sheenColor.value.copy(t.sheenColor).multiplyScalar(t.sheen),e.sheenRoughness.value=t.sheenRoughness,t.sheenColorMap&&(e.sheenColorMap.value=t.sheenColorMap,n(t.sheenColorMap,e.sheenColorMapTransform)),t.sheenRoughnessMap&&(e.sheenRoughnessMap.value=t.sheenRoughnessMap,n(t.sheenRoughnessMap,e.sheenRoughnessMapTransform))),t.clearcoat>0&&(e.clearcoat.value=t.clearcoat,e.clearcoatRoughness.value=t.clearcoatRoughness,t.clearcoatMap&&(e.clearcoatMap.value=t.clearcoatMap,n(t.clearcoatMap,e.clearcoatMapTransform)),t.clearcoatRoughnessMap&&(e.clearcoatRoughnessMap.value=t.clearcoatRoughnessMap,n(t.clearcoatRoughnessMap,e.clearcoatRoughnessMapTransform)),t.clearcoatNormalMap&&(e.clearcoatNormalMap.value=t.clearcoatNormalMap,n(t.clearcoatNormalMap,e.clearcoatNormalMapTransform),e.clearcoatNormalScale.value.copy(t.clearcoatNormalScale),t.side===1&&e.clearcoatNormalScale.value.negate())),t.dispersion>0&&(e.dispersion.value=t.dispersion),t.retroreflectivity>0&&(e.retroreflectivity.value=t.retroreflectivity),t.iridescence>0&&(e.iridescence.value=t.iridescence,e.iridescenceIOR.value=t.iridescenceIOR,e.iridescenceThicknessMinimum.value=t.iridescenceThicknessRange[0],e.iridescenceThicknessMaximum.value=t.iridescenceThicknessRange[1],t.iridescenceMap&&(e.iridescenceMap.value=t.iridescenceMap,n(t.iridescenceMap,e.iridescenceMapTransform)),t.iridescenceThicknessMap&&(e.iridescenceThicknessMap.value=t.iridescenceThicknessMap,n(t.iridescenceThicknessMap,e.iridescenceThicknessMapTransform))),t.transmission>0&&(e.transmission.value=t.transmission,e.transmissionSamplerMap.value=r.texture,e.transmissionSamplerSize.value.set(r.width,r.height),t.transmissionMap&&(e.transmissionMap.value=t.transmissionMap,n(t.transmissionMap,e.transmissionMapTransform)),e.thickness.value=t.thickness,t.thicknessMap&&(e.thicknessMap.value=t.thicknessMap,n(t.thicknessMap,e.thicknessMapTransform)),e.attenuationDistance.value=t.attenuationDistance,e.attenuationColor.value.copy(t.attenuationColor)),t.anisotropy>0&&(e.anisotropyVector.value.set(t.anisotropy*Math.cos(t.anisotropyRotation),t.anisotropy*Math.sin(t.anisotropyRotation)),t.anisotropyMap&&(e.anisotropyMap.value=t.anisotropyMap,n(t.anisotropyMap,e.anisotropyMapTransform))),e.specularIntensity.value=t.specularIntensity,e.specularColor.value.copy(t.specularColor),t.specularColorMap&&(e.specularColorMap.value=t.specularColorMap,n(t.specularColorMap,e.specularColorMapTransform)),t.specularIntensityMap&&(e.specularIntensityMap.value=t.specularIntensityMap,n(t.specularIntensityMap,e.specularIntensityMapTransform))}function m(e,t){t.matcap&&(e.matcap.value=t.matcap)}function h(e,n){let r=t.get(n).light;e.referencePosition.value.setFromMatrixPosition(r.matrixWorld),e.nearDistance.value=r.shadow.camera.near,e.farDistance.value=r.shadow.camera.far}return{refreshFogUniforms:r,refreshMaterialUniforms:i}}function Ha(e,t,n,r){let i={},a={},o=[],s=e.getParameter(e.MAX_UNIFORM_BUFFER_BINDINGS);function c(e,t){let n=t.program;r.uniformBlockBinding(e,n)}function l(e,n){let o=i[e.id];o===void 0&&(g(e),o=u(e),i[e.id]=o,e.addEventListener(`dispose`,v));let s=n.program;r.updateUBOMapping(e,s);let c=t.render.frame;a[e.id]!==c&&(f(e),a[e.id]=c)}function u(t){let n=d();t.__bindingPointIndex=n;let r=e.createBuffer(),i=t.__size,a=t.usage;return e.bindBuffer(e.UNIFORM_BUFFER,r),e.bufferData(e.UNIFORM_BUFFER,i,a),e.bindBuffer(e.UNIFORM_BUFFER,null),e.bindBufferBase(e.UNIFORM_BUFFER,n,r),r}function d(){for(let e=0;e<s;e++)if(o.indexOf(e)===-1)return o.push(e),e;return U(`WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached.`),0}function f(t){let n=i[t.id],r=t.uniforms,a=t.__cache;e.bindBuffer(e.UNIFORM_BUFFER,n);for(let e=0,t=r.length;e<t;e++){let t=r[e];if(Array.isArray(t))for(let n=0,r=t.length;n<r;n++)p(t[n],e,n,a);else p(t,e,0,a)}e.bindBuffer(e.UNIFORM_BUFFER,null)}function p(t,n,r,i){if(h(t,n,r,i)===!0){let n=t.__offset,r=t.value;if(Array.isArray(r)){let e=0;for(let n=0;n<r.length;n++){let i=r[n],a=_(i);m(i,t.__data,e),typeof i!=`number`&&typeof i!=`boolean`&&!i.isMatrix3&&!ArrayBuffer.isView(i)&&(e+=a.storage/Float32Array.BYTES_PER_ELEMENT)}}else m(r,t.__data,0);e.bufferSubData(e.UNIFORM_BUFFER,n,t.__data)}}function m(e,t,n){typeof e==`number`||typeof e==`boolean`?t[0]=e:e.isMatrix3?(t[0]=e.elements[0],t[1]=e.elements[1],t[2]=e.elements[2],t[3]=0,t[4]=e.elements[3],t[5]=e.elements[4],t[6]=e.elements[5],t[7]=0,t[8]=e.elements[6],t[9]=e.elements[7],t[10]=e.elements[8],t[11]=0):ArrayBuffer.isView(e)?t.set(new e.constructor(e.buffer,e.byteOffset,t.length)):e.toArray(t,n)}function h(e,t,n,r){let i=e.value,a=t+`_`+n;if(r[a]===void 0)return r[a]=typeof i==`number`||typeof i==`boolean`?i:ArrayBuffer.isView(i)?i.slice():i.clone(),!0;{let e=r[a];if(typeof i==`number`||typeof i==`boolean`){if(e!==i)return r[a]=i,!0}else if(ArrayBuffer.isView(i))return!0;else if(e.equals(i)===!1)return e.copy(i),!0}return!1}function g(e){let t=e.uniforms,n=0;for(let e=0,r=t.length;e<r;e++){let r=Array.isArray(t[e])?t[e]:[t[e]];for(let e=0,t=r.length;e<t;e++){let t=r[e],i=Array.isArray(t.value)?t.value:[t.value];for(let e=0,r=i.length;e<r;e++){let r=i[e],a=_(r),o=n%16,s=o%a.boundary,c=o+s;n+=s,c!==0&&16-c<a.storage&&(n+=16-c),t.__data=new Float32Array(a.storage/Float32Array.BYTES_PER_ELEMENT),t.__offset=n,n+=a.storage}}}let r=n%16;return r>0&&(n+=16-r),e.__size=n,e.__cache={},this}function _(e){let t={boundary:0,storage:0};return typeof e==`number`||typeof e==`boolean`?(t.boundary=4,t.storage=4):e.isVector2?(t.boundary=8,t.storage=8):e.isVector3||e.isColor?(t.boundary=16,t.storage=12):e.isVector4?(t.boundary=16,t.storage=16):e.isMatrix3?(t.boundary=48,t.storage=48):e.isMatrix4?(t.boundary=64,t.storage=64):e.isTexture?G(`WebGLRenderer: Texture samplers can not be part of an uniforms group.`):ArrayBuffer.isView(e)?(t.boundary=16,t.storage=e.byteLength):G(`WebGLRenderer: Unsupported uniform value type.`,e),t}function v(t){let n=t.target;n.removeEventListener(`dispose`,v);let r=o.indexOf(n.__bindingPointIndex);o.splice(r,1),e.deleteBuffer(i[n.id]),delete i[n.id],delete a[n.id]}function y(){for(let t in i)e.deleteBuffer(i[t]);o=[],i={},a={}}return{bind:c,update:l,dispose:y}}var Ua=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Wa=null;function Ga(){return Wa===null&&(Wa=new yt(Ua,16,16,ct,Ze),Wa.name=`DFG_LUT`,Wa.minFilter=cn,Wa.magFilter=cn,Wa.wrapS=Rt,Wa.wrapT=Rt,Wa.generateMipmaps=!1,Wa.needsUpdate=!0),Wa}var Ka=class{constructor(e={}){let{canvas:t=ot(),context:n=null,depth:r=!0,stencil:i=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:s=!0,preserveDrawingBuffer:c=!1,powerPreference:l=`default`,failIfMajorPerformanceCaveat:u=!1,reversedDepthBuffer:d=!1,outputBufferType:f=en}=e;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<`u`&&n instanceof WebGLRenderingContext)throw Error(`THREE.WebGLRenderer: WebGL 1 is not supported since r163.`);p=n.getContextAttributes().alpha}else p=a;let m=f,h=new Set([qt,ut,Jt]),g=new Set([en,Vt,gt,Et,jt,kt]),_=new Uint32Array(4),v=new Int32Array(4),y=new Z,b=null,x=null,S=[],C=[],w=null;this.domElement=t,this.debug={checkShaderErrors:!0,diagnostics:{keywords:!1},onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=0,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let T=this,E=!1,D=null,O=null,k=null,A=null;this._outputColorSpace=wt;let j=0,M=0,N=null,ee=-1,P=null,te=new K,ne=new K,re=null,ie=new Y(0),ae=0,F=t.width,oe=t.height,I=1,se=null,ce=null,le=new K(0,0,F,oe),ue=new K(0,0,F,oe),de=!1,fe=new Ne,pe=!1,me=!1,he=new Ke,ge=new Z,_e=new K,ve={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},ye=!1;function be(){return N===null?I:1}let L=n;function xe(e,n){return t.getContext(e,n)}let R,Se,z,Ce,B,V,we,Te,H,Ee,De,Oe,ke,Ae,je,Me,Ie,Le,Re,ze,Be,W,Ve;try{let e={alpha:!0,depth:r,stencil:i,antialias:o,premultipliedAlpha:s,preserveDrawingBuffer:c,powerPreference:l,failIfMajorPerformanceCaveat:u};if(`setAttribute`in t&&t.setAttribute(`data-engine`,`three.js r186`),t.addEventListener(`webglcontextlost`,We,!1),t.addEventListener(`webglcontextrestored`,Ge,!1),t.addEventListener(`webglcontextcreationerror`,qe,!1),L===null){let t=`webgl2`;if(L=xe(t,e),L===null)throw xe(t)?Error(`THREE.WebGLRenderer: Error creating WebGL context with your selected attributes.`):Error(`THREE.WebGLRenderer: Error creating WebGL context.`)}He()}catch(e){throw t.removeEventListener(`webglcontextlost`,We,!1),t.removeEventListener(`webglcontextrestored`,Ge,!1),t.removeEventListener(`webglcontextcreationerror`,qe,!1),U(`WebGLRenderer: `+e.message),e}function He(){R=new ur(L),R.init(),Be=new Pa(L,R),Se=new zn(L,R,e,Be),z=new Ma(L,R),Se.reversedDepthBuffer&&d&&z.buffers.depth.setReversed(!0),O=L.createFramebuffer(),k=L.createFramebuffer(),A=L.createFramebuffer(),Ce=new pr(L),B=new fa,V=new Na(L,R,z,B,Se,Be,Ce),we=new lr(T),Te=new jn(L),W=new Ln(L,Te),H=new dr(L,Te,Ce,W),Ee=new hr(L,H,Te,W,Ce),Le=new mr(L,Se,V),je=new Bn(B),De=new da(T,we,R,Se,W,je),Oe=new Va(T,B),ke=new ga,Ae=new Ca(R),Ie=new In(T,we,z,Ee,p,s),Me=new ja(T,Ee,Se),Ve=new Ha(L,Ce,Se,z),Re=new Rn(L,R,Ce),ze=new fr(L,R,Ce),Ce.programs=De.programs,T.capabilities=Se,T.extensions=R,T.properties=B,T.renderLists=ke,T.shadowMap=Me,T.state=z,T.info=Ce}m!==1009&&(w=new _r(m,t.width,t.height,o,r,i));let Ue=new Ra(T,L);this.xr=Ue,this.getContext=function(){return L},this.getContextAttributes=function(){return L.getContextAttributes()},this.forceContextLoss=function(){let e=R.get(`WEBGL_lose_context`);e&&e.loseContext()},this.forceContextRestore=function(){let e=R.get(`WEBGL_lose_context`);e&&e.restoreContext()},this.getPixelRatio=function(){return I},this.setPixelRatio=function(e){e!==void 0&&(I=e,this.setSize(F,oe,!1))},this.getSize=function(e){return e.set(F,oe)},this.setSize=function(e,n,r=!0){if(Ue.isPresenting){G(`WebGLRenderer: Can't change size while VR device is presenting.`);return}F=e,oe=n,t.width=Math.floor(e*I),t.height=Math.floor(n*I),r===!0&&(t.style.width=e+`px`,t.style.height=n+`px`),w!==null&&w.setSize(t.width,t.height),this.setViewport(0,0,e,n)},this.getDrawingBufferSize=function(e){return e.set(F*I,oe*I).floor()},this.setDrawingBufferSize=function(e,n,r){F=e,oe=n,I=r,t.width=Math.floor(e*r),t.height=Math.floor(n*r),this.setViewport(0,0,e,n)},this.setEffects=function(e){if(m===1009){U(`WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.`);return}if(e){for(let t=0;t<e.length;t++)if(e[t].isOutputPass===!0){G(`WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.`);break}}w.setEffects(e||[])},this.getCurrentViewport=function(e){return e.copy(te)},this.getViewport=function(e){return e.copy(le)},this.setViewport=function(e,t,n,r){e.isVector4?le.set(e.x,e.y,e.z,e.w):le.set(e,t,n,r),z.viewport(te.copy(le).multiplyScalar(I).round())},this.getScissor=function(e){return e.copy(ue)},this.setScissor=function(e,t,n,r){e.isVector4?ue.set(e.x,e.y,e.z,e.w):ue.set(e,t,n,r),z.scissor(ne.copy(ue).multiplyScalar(I).round())},this.getScissorTest=function(){return de},this.setScissorTest=function(e){z.setScissorTest(de=e)},this.setOpaqueSort=function(e){se=e},this.setTransparentSort=function(e){ce=e},this.getClearColor=function(e){return e.copy(Ie.getClearColor())},this.setClearColor=function(){Ie.setClearColor(...arguments)},this.getClearAlpha=function(){return Ie.getClearAlpha()},this.setClearAlpha=function(){Ie.setClearAlpha(...arguments)},this.clear=function(e=!0,t=!0,n=!0){let r=0;if(e){let e=!1;if(N!==null){let t=N.texture.format;e=h.has(t)}if(e){let e=N.texture.type,t=g.has(e),n=Ie.getClearColor(),r=Ie.getClearAlpha(),i=n.r,a=n.g,o=n.b;t?(_[0]=i,_[1]=a,_[2]=o,_[3]=r,L.clearBufferuiv(L.COLOR,0,_)):(v[0]=i,v[1]=a,v[2]=o,v[3]=r,L.clearBufferiv(L.COLOR,0,v))}else r|=L.COLOR_BUFFER_BIT}t&&(r|=L.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),n&&(r|=L.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),r!==0&&L.clear(r)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(e){e.setRenderer(this),D=e},this.dispose=function(){t.removeEventListener(`webglcontextlost`,We,!1),t.removeEventListener(`webglcontextrestored`,Ge,!1),t.removeEventListener(`webglcontextcreationerror`,qe,!1),Ie.dispose(),ke.dispose(),Ae.dispose(),B.dispose(),we.dispose(),Ee.dispose(),W.dispose(),Ve.dispose(),De.dispose(),Ue.dispose(),Ue.removeEventListener(`sessionstart`,nt),Ue.removeEventListener(`sessionend`,rt),at.stop()};function We(e){e.preventDefault(),Pe(`WebGLRenderer: Context Lost.`),E=!0}function Ge(){Pe(`WebGLRenderer: Context Restored.`),E=!1;let e=Ce.autoReset,t=Me.enabled,n=Me.autoUpdate,r=Me.needsUpdate,i=Me.type;He(),Ce.autoReset=e,Me.enabled=t,Me.autoUpdate=n,Me.needsUpdate=r,Me.type=i}function qe(e){U(`WebGLRenderer: A WebGL context could not be created. Reason: `,e.statusMessage)}function Je(e){let t=e.target;t.removeEventListener(`dispose`,Je),Ye(t)}function Ye(e){Qe(e),B.remove(e)}function Qe(e){let t=B.get(e).programs;t!==void 0&&(t.forEach(function(e){De.releaseProgram(e)}),e.isShaderMaterial&&De.releaseShaderCache(e))}this.renderBufferDirect=function(e,t,n,r,i,a){t===null&&(t=ve);let o=i.isMesh&&i.matrixWorld.determinantAffine()<0,s=vt(e,t,n,r,i);z.setMaterial(r,o);let c=n.index,l=1;if(r.wireframe===!0){if(c=H.getWireframeAttribute(n),c===void 0)return;l=2}let u=n.drawRange,d=n.attributes.position,f=u.start*l,p=(u.start+u.count)*l;a!==null&&(f=Math.max(f,a.start*l),p=Math.min(p,(a.start+a.count)*l)),c===null?d!=null&&(f=Math.max(f,0),p=Math.min(p,d.count)):(f=Math.max(f,0),p=Math.min(p,c.count));let m=p-f;if(m<0||m===1/0)return;W.setup(i,r,s,n,c);let h,g=Re;if(c!==null&&(h=Te.get(c),g=ze,g.setIndex(h)),i.isMesh)r.wireframe===!0?(z.setLineWidth(r.wireframeLinewidth*be()),g.setMode(L.LINES)):g.setMode(L.TRIANGLES);else if(i.isLine){let e=r.linewidth;e===void 0&&(e=1),z.setLineWidth(e*be()),i.isLineSegments?g.setMode(L.LINES):i.isLineLoop?g.setMode(L.LINE_LOOP):g.setMode(L.LINE_STRIP)}else i.isPoints?g.setMode(L.POINTS):i.isSprite&&g.setMode(L.TRIANGLES);if(i.isBatchedMesh){if(R.get(`WEBGL_multi_draw`))g.renderMultiDraw(i._multiDrawStarts,i._multiDrawCounts,i._multiDrawCount);else{let e=i._multiDrawStarts,t=i._multiDrawCounts,n=i._multiDrawCount,a=c?Te.get(c).bytesPerElement:1,o=B.get(r).currentProgram.getUniforms();for(let r=0;r<n;r++)o.setValue(L,`_gl_DrawID`,r),g.render(e[r]/a,t[r])}}else if(i.isInstancedMesh)g.renderInstances(f,m,i.count);else if(n.isInstancedBufferGeometry){let e=n._maxInstanceCount===void 0?1/0:n._maxInstanceCount,t=Math.min(n.instanceCount,e);g.renderInstances(f,m,t)}else g.render(f,m)};function $e(e,t,n,r){D!==null&&e.isNodeMaterial&&D.setObject(r,e),pe===!0&&je.setState(e,n,!1),e.transparent===!0&&e.side===2&&e.forceSinglePass===!1?(e.side=1,e.needsUpdate=!0,pt(e,t,r),e.side=0,e.needsUpdate=!0,pt(e,t,r),e.side=2):pt(e,t,r)}this.compile=function(e,t,n=null){n===null&&(n=e),D!==null&&D.renderStart(e,t,n),x=Ae.get(n),x.init(t),C.push(x),n.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(x.pushLight(e),e.castShadow&&x.pushShadow(e))}),e!==n&&e.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(x.pushLight(e),e.castShadow&&x.pushShadow(e))}),x.setupLights(),D!==null&&D.updateLights(x.state.lightsArray),me=this.localClippingEnabled,pe=je.init(this.clippingPlanes,me),pe===!0&&je.setGlobalState(this.clippingPlanes,t),D!==null&&Me.render(x.state.shadowsArray,n,t);let r=new Set;return e.traverse(function(e){if(!(e.isMesh||e.isPoints||e.isLine||e.isSprite))return;let i=e.material;if(i){if(Array.isArray(i))for(let a=0;a<i.length;a++){let o=i[a];$e(o,n,t,e),r.add(o)}else $e(i,n,t,e),r.add(i)}}),x=C.pop(),D!==null&&D.renderEnd(),r},this.compileAsync=function(e,t,n=null){let r=this.compile(e,t,n);return new Promise(t=>{function n(){if(r.forEach(function(e){let t=B.get(e).currentProgram;(t===void 0||t.isReady())&&r.delete(e)}),r.size===0){t(e);return}setTimeout(n,10)}R.get(`KHR_parallel_shader_compile`)===null?setTimeout(n,10):n()})};let et=null;function tt(e){et&&et(e)}function nt(){at.stop()}function rt(){at.start()}let at=new An;at.setAnimationLoop(tt),typeof self<`u`&&at.setContext(self),this.setAnimationLoop=function(e){et=e,Ue.setAnimationLoop(e),e===null?at.stop():at.start()},Ue.addEventListener(`sessionstart`,nt),Ue.addEventListener(`sessionend`,rt),this.render=function(e,t){if(t!==void 0&&t.isCamera!==!0){U(`WebGLRenderer.render: camera is not an instance of THREE.Camera.`);return}if(E===!0)return;D!==null&&D.renderStart(e,t);let n=Ue.enabled===!0&&Ue.isPresenting===!0,r=w!==null&&(N===null||n)&&w.begin(T,N);if(e.matrixWorldAutoUpdate===!0&&e.updateMatrixWorld(),t.parent===null&&t.matrixWorldAutoUpdate===!0&&t.updateMatrixWorld(),Ue.enabled===!0&&Ue.isPresenting===!0&&(w===null||w.isCompositing()===!1)&&(Ue.cameraAutoUpdate===!0&&Ue.updateCamera(t),t=Ue.getCamera()),e.isScene===!0&&e.onBeforeRender(T,e,t,N),x=Ae.get(e,C.length),x.init(t),x.state.textureUnits=V.getTextureUnits(),C.push(x),he.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),fe.setFromProjectionMatrix(he,on,t.reversedDepth),me=this.localClippingEnabled,pe=je.init(this.clippingPlanes,me),b=ke.get(e,S.length),b.init(),S.push(b),Ue.enabled===!0&&Ue.isPresenting===!0){let e=T.xr.getDepthSensingMesh();e!==null&&st(e,t,-1/0,T.sortObjects)}st(e,t,0,T.sortObjects),b.finish(),D!==null&&D.updateLights(x.state.lightsArray),T.sortObjects===!0&&b.sort(se,ce),ye=Ue.enabled===!1||Ue.isPresenting===!1||Ue.hasDepthSensing()===!1,ye&&Ie.addToRenderList(b,e),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),pe===!0&&je.beginShadows();let i=x.state.shadowsArray;if(Me.render(i,e,t),pe===!0&&je.endShadows(),(r&&w.hasRenderPass())===!1){let n=b.opaque,r=b.transmissive;if(x.setupLights(),t.isArrayCamera){let i=t.cameras;if(r.length>0)for(let t=0,a=i.length;t<a;t++){let a=i[t];lt(n,r,e,a)}ye&&Ie.render(e);for(let t=0,n=i.length;t<n;t++){let n=i[t];ct(b,e,n,n.viewport)}}else r.length>0&&lt(n,r,e,t),ye&&Ie.render(e),ct(b,e,t)}N!==null&&M===0&&(V.updateMultisampleRenderTarget(N),V.updateRenderTargetMipmap(N)),r&&w.end(T),e.isScene===!0&&e.onAfterRender(T,e,t),W.resetDefaultState(),ee=-1,P=null,C.pop(),C.length>0?(x=C[C.length-1],V.setTextureUnits(x.state.textureUnits),pe===!0&&je.setGlobalState(T.clippingPlanes,x.state.camera)):x=null,S.pop(),b=S.length>0?S[S.length-1]:null,D!==null&&D.renderEnd()};function st(e,t,n,r){if(e.visible===!1)return;if(e.layers.test(t.layers)){if(e.isGroup)n=e.renderOrder;else if(e.isLOD)e.autoUpdate===!0&&e.update(t);else if(e.isLightProbeGrid)x.pushLightProbeGrid(e);else if(e.isLight)x.pushLight(e),e.castShadow&&x.pushShadow(e);else if(e.isSprite){if(!e.frustumCulled||e.intersectsFrustum(fe)){r&&_e.setFromMatrixPosition(e.matrixWorld).applyMatrix4(he);let i=Ee.update(e),a=e.material;a.visible&&b.push(e,i,a,n,_e.z,null,t)}}else if((e.isMesh||e.isLine||e.isPoints)&&(!e.frustumCulled||e.intersectsFrustum(fe))){let i=Ee.update(e),a=e.material;if(r&&(e.boundingSphere===void 0?(i.boundingSphere===null&&i.computeBoundingSphere(),_e.copy(i.boundingSphere.center)):(e.boundingSphere===null&&e.computeBoundingSphere(),_e.copy(e.boundingSphere.center)),_e.applyMatrix4(e.matrixWorld).applyMatrix4(he)),Array.isArray(a)){let r=i.groups;for(let o=0,s=r.length;o<s;o++){let s=r[o],c=a[s.materialIndex];c&&c.visible&&b.push(e,i,c,n,_e.z,s,t)}}else a.visible&&b.push(e,i,a,n,_e.z,null,t)}}let i=e.children;for(let e=0,a=i.length;e<a;e++)st(i[e],t,n,r)}function ct(e,t,n,r){let{opaque:i,transmissive:a,transparent:o}=e;x.setupLightsView(n),pe===!0&&je.setGlobalState(T.clippingPlanes,n),r&&z.viewport(te.copy(r)),i.length>0&&dt(i,t,n),a.length>0&&dt(a,t,n),o.length>0&&dt(o,t,n),z.buffers.depth.setTest(!0),z.buffers.depth.setMask(!0),z.buffers.color.setMask(!0),z.setPolygonOffset(!1)}function lt(e,t,n,r){if((n.isScene===!0?n.overrideMaterial:null)!==null)return;if(x.state.transmissionRenderTarget[r.id]===void 0){let e=R.has(`EXT_color_buffer_half_float`)||R.has(`EXT_color_buffer_float`);x.state.transmissionRenderTarget[r.id]=new it(1,1,{generateMipmaps:!0,type:e?Ze:en,minFilter:Fe,samples:Math.max(4,Se.samples),stencilBuffer:i,resolveDepthBuffer:!1,resolveStencilBuffer:!1,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,colorSpace:Ct.workingColorSpace})}let a=x.state.transmissionRenderTarget[r.id],o=r.viewport||te;a.setSize(o.z*T.transmissionResolutionScale,o.w*T.transmissionResolutionScale);let s=T.getRenderTarget(),c=T.getActiveCubeFace(),l=T.getActiveMipmapLevel();T.setRenderTarget(a),T.getClearColor(ie),ae=T.getClearAlpha(),ae<1&&T.setClearColor(16777215,.5),T.clear(),ye&&Ie.render(n);let u=T.toneMapping;T.toneMapping=0;let d=r.viewport;if(r.viewport!==void 0&&(r.viewport=void 0),x.setupLightsView(r),pe===!0&&je.setGlobalState(T.clippingPlanes,r),dt(e,n,r),V.updateMultisampleRenderTarget(a),V.updateRenderTargetMipmap(a),R.has(`WEBGL_multisampled_render_to_texture`)===!1){let e=!1;for(let i=0,a=t.length;i<a;i++){let{object:a,geometry:o,material:s,group:c}=t[i];if(s.side===2&&a.layers.test(r.layers)){let t=s.side;s.side=1,s.needsUpdate=!0,ft(a,n,r,o,s,c),s.side=t,s.needsUpdate=!0,e=!0}}e===!0&&(V.updateMultisampleRenderTarget(a),V.updateRenderTargetMipmap(a))}T.setRenderTarget(s,c,l),T.setClearColor(ie,ae),d!==void 0&&(r.viewport=d),T.toneMapping=u}function dt(e,t,n){let r=t.isScene===!0?t.overrideMaterial:null;for(let i=0,a=e.length;i<a;i++){let a=e[i],{object:o,geometry:s,group:c}=a,l=a.material;l.allowOverride===!0&&r!==null&&(l=r),o.layers.test(n.layers)&&ft(o,t,n,s,l,c)}}function ft(e,t,n,r,i,a){D!==null&&i.isNodeMaterial&&D.setObject(e,i),e.onBeforeRender(T,t,n,r,i,a),e.modelViewMatrix.multiplyMatrices(n.matrixWorldInverse,e.matrixWorld),e.normalMatrix.getNormalMatrix(e.modelViewMatrix),i.onBeforeRender(T,t,n,r,e,a),i.transparent===!0&&i.side===2&&i.forceSinglePass===!1?(i.side=1,i.needsUpdate=!0,T.renderBufferDirect(n,t,r,i,e,a),i.side=0,i.needsUpdate=!0,T.renderBufferDirect(n,t,r,i,e,a),i.side=2):T.renderBufferDirect(n,t,r,i,e,a),e.onAfterRender(T,t,n,r,i,a)}function pt(e,t,n){t.isScene!==!0&&(t=ve);let r=B.get(e),i=x.state.lights,a=x.state.shadowsArray,o=i.state.version,s=De.getParameters(e,i.state,a,t,n,x.state.lightProbeGridArray),c=De.getProgramCacheKey(s),l=r.programs;r.environment=e.isMeshStandardMaterial||e.isMeshLambertMaterial||e.isMeshPhongMaterial?t.environment:null,r.fog=t.fog;let u=e.isMeshStandardMaterial||e.isMeshLambertMaterial&&!e.envMap||e.isMeshPhongMaterial&&!e.envMap;r.envMap=we.get(e.envMap||r.environment,u),r.envMapRotation=r.environment!==null&&e.envMap===null?t.environmentRotation:e.envMapRotation,l===void 0&&(e.addEventListener(`dispose`,Je),l=new Map,r.programs=l);let d=l.get(c);if(d!==void 0){if(r.currentProgram===d&&r.lightsStateVersion===o)return ht(e,s),d}else s.uniforms=De.getUniforms(e),D!==null&&e.isNodeMaterial&&D.build(e,n,s),e.onBeforeCompile(s,T),d=De.acquireProgram(s,c),l.set(c,d),r.uniforms=s.uniforms;let f=r.uniforms;return(!e.isShaderMaterial&&!e.isRawShaderMaterial||e.clipping===!0)&&(f.clippingPlanes=je.uniform),ht(e,s),r.needsLights=bt(e),r.lightsStateVersion=o,r.needsLights&&(f.ambientLightColor.value=i.state.ambient,f.lightProbe.value=i.state.probe,f.sunLights.value=i.state.sun,f.sunLightShadows.value=i.state.sunShadow,f.directionalLights.value=i.state.directional,f.directionalLightShadows.value=i.state.directionalShadow,f.spotLights.value=i.state.spot,f.spotLightShadows.value=i.state.spotShadow,f.rectAreaLights.value=i.state.rectArea,f.ltc_1.value=i.state.rectAreaLTC1,f.ltc_2.value=i.state.rectAreaLTC2,f.pointLights.value=i.state.point,f.pointLightShadows.value=i.state.pointShadow,f.hemisphereLights.value=i.state.hemi,f.sunShadowMatrix.value=i.state.sunShadowMatrix,f.sunShadowCascade.value=i.state.sunShadowCascade,f.directionalShadowMatrix.value=i.state.directionalShadowMatrix,f.spotLightMatrix.value=i.state.spotLightMatrix,f.spotLightMap.value=i.state.spotLightMap,f.pointShadowMatrix.value=i.state.pointShadowMatrix),r.lightProbeGrid=x.state.lightProbeGridArray.length>0,r.currentProgram=d,r.uniformsList=null,d}function mt(e){if(e.uniformsList===null){let t=e.currentProgram.getUniforms();e.uniformsList=wi.seqWithValue(t.seq,e.uniforms)}return e.uniformsList}function ht(e,t){let n=B.get(e);n.outputColorSpace=t.outputColorSpace,n.batching=t.batching,n.batchingColor=t.batchingColor,n.instancing=t.instancing,n.instancingColor=t.instancingColor,n.instancingMorph=t.instancingMorph,n.skinning=t.skinning,n.morphTargets=t.morphTargets,n.morphNormals=t.morphNormals,n.morphColors=t.morphColors,n.morphTargetsCount=t.morphTargetsCount,n.numClippingPlanes=t.numClippingPlanes,n.numIntersection=t.numClipIntersection,n.vertexAlphas=t.vertexAlphas,n.vertexTangents=t.vertexTangents,n.toneMapping=t.toneMapping}function _t(e,t){if(e.length===0)return null;if(e.length===1)return e[0].texture===null?null:e[0];y.setFromMatrixPosition(t.matrixWorld);for(let t=0,n=e.length;t<n;t++){let n=e[t];if(n.texture!==null&&n.boundingBox.containsPoint(y))return n}return null}function vt(e,t,n,r,i){t.isScene!==!0&&(t=ve),V.resetTextureUnits();let a=t.fog,o=r.isMeshStandardMaterial||r.isMeshLambertMaterial||r.isMeshPhongMaterial?t.environment:null,s=N===null?T.outputColorSpace:N.isXRRenderTarget===!0?N.texture.colorSpace:Ct.workingColorSpace,c=r.isMeshStandardMaterial||r.isMeshLambertMaterial&&!r.envMap||r.isMeshPhongMaterial&&!r.envMap,l=we.get(r.envMap||o,c),u=r.vertexColors===!0&&!!n.attributes.color&&n.attributes.color.itemSize===4,d=!!n.attributes.tangent&&(!!r.normalMap||r.anisotropy>0),f=!!n.morphAttributes.position,p=!!n.morphAttributes.normal,m=!!n.morphAttributes.color,h=0;r.toneMapped&&(N===null||N.isXRRenderTarget===!0)&&(h=T.toneMapping);let g=n.morphAttributes.position||n.morphAttributes.normal||n.morphAttributes.color,_=g===void 0?0:g.length,v=B.get(r),y=x.state.lights;if(pe===!0&&(me===!0||e!==P)){let t=e===P&&r.id===ee;je.setState(r,e,t)}let b=!1;r.version===v.__version?v.needsLights&&v.lightsStateVersion!==y.state.version?b=!0:v.outputColorSpace===s?i.isBatchedMesh&&v.batching===!1||!i.isBatchedMesh&&v.batching===!0||i.isBatchedMesh&&v.batchingColor===!0&&i._colorsTexture===null||i.isBatchedMesh&&v.batchingColor===!1&&i._colorsTexture!==null||i.isInstancedMesh&&v.instancing===!1||!i.isInstancedMesh&&v.instancing===!0||i.isSkinnedMesh&&v.skinning===!1||!i.isSkinnedMesh&&v.skinning===!0||i.isInstancedMesh&&v.instancingColor===!0&&i.instanceColor===null||i.isInstancedMesh&&v.instancingColor===!1&&i.instanceColor!==null||i.isInstancedMesh&&v.instancingMorph===!0&&i.morphTexture===null||i.isInstancedMesh&&v.instancingMorph===!1&&i.morphTexture!==null?b=!0:v.envMap===l?r.fog===!0&&v.fog!==a||v.numClippingPlanes!==void 0&&(v.numClippingPlanes!==je.numPlanes||v.numIntersection!==je.numIntersection)?b=!0:v.vertexAlphas===u&&v.vertexTangents===d&&v.morphTargets===f&&v.morphNormals===p&&v.morphColors===m&&v.toneMapping===h&&v.morphTargetsCount===_?!!v.lightProbeGrid!=x.state.lightProbeGridArray.length>0&&(b=!0):b=!0:b=!0:b=!0:(b=!0,v.__version=r.version);let S=v.currentProgram;b===!0&&(S=pt(r,t,i),D&&r.isNodeMaterial&&D.onUpdateProgram(r,S,v));let C=!1,w=!1,E=!1,O=S.getUniforms(),k=v.uniforms;if(z.useProgram(S.program)&&(C=!0,w=!0,E=!0),r.id!==ee&&(ee=r.id,w=!0),v.needsLights){let e=_t(x.state.lightProbeGridArray,i);v.lightProbeGrid!==e&&(v.lightProbeGrid=e,w=!0)}if(C||P!==e){z.buffers.depth.getReversed()&&e.reversedDepth!==!0&&(e._reversedDepth=!0,e.updateProjectionMatrix()),O.setValue(L,`projectionMatrix`,e.projectionMatrix),O.setValue(L,`viewMatrix`,e.matrixWorldInverse);let t=O.map.cameraPosition;t!==void 0&&t.setValue(L,ge.setFromMatrixPosition(e.matrixWorld)),Se.logarithmicDepthBuffer&&O.setValue(L,`logDepthBufFC`,2/(Math.log(e.far+1)/Math.LN2)),(r.isMeshPhongMaterial||r.isMeshToonMaterial||r.isMeshLambertMaterial||r.isMeshBasicMaterial||r.isMeshStandardMaterial||r.isShaderMaterial)&&O.setValue(L,`isOrthographic`,e.isOrthographicCamera===!0),P!==e&&(P=e,w=!0,E=!0)}if(v.needsLights&&(y.state.sunShadowMap.length>0&&O.setValue(L,`sunShadowMap`,y.state.sunShadowMap,V),y.state.directionalShadowMap.length>0&&O.setValue(L,`directionalShadowMap`,y.state.directionalShadowMap,V),y.state.spotShadowMap.length>0&&O.setValue(L,`spotShadowMap`,y.state.spotShadowMap,V),y.state.pointShadowMap.length>0&&O.setValue(L,`pointShadowMap`,y.state.pointShadowMap,V)),i.isSkinnedMesh){O.setOptional(L,i,`bindMatrix`),O.setOptional(L,i,`bindMatrixInverse`);let e=i.skeleton;e&&(e.boneTexture===null&&e.computeBoneTexture(),O.setValue(L,`boneTexture`,e.boneTexture,V))}i.isBatchedMesh&&(O.setOptional(L,i,`batchingTexture`),O.setValue(L,`batchingTexture`,i._matricesTexture,V),O.setOptional(L,i,`batchingIdTexture`),O.setValue(L,`batchingIdTexture`,i._indirectTexture,V),O.setOptional(L,i,`batchingColorTexture`),i._colorsTexture!==null&&O.setValue(L,`batchingColorTexture`,i._colorsTexture,V));let A=n.morphAttributes;if((A.position!==void 0||A.normal!==void 0||A.color!==void 0)&&Le.update(i,n,S),(w||v.receiveShadow!==i.receiveShadow)&&(v.receiveShadow=i.receiveShadow,O.setValue(L,`receiveShadow`,i.receiveShadow)),(r.isMeshStandardMaterial||r.isMeshLambertMaterial||r.isMeshPhongMaterial)&&r.envMap===null&&t.environment!==null&&(k.envMapIntensity.value=t.environmentIntensity),k.dfgLUT!==void 0&&(k.dfgLUT.value=Ga()),w){if(O.setValue(L,`toneMappingExposure`,T.toneMappingExposure),v.needsLights&&yt(k,E),a&&r.fog===!0&&Oe.refreshFogUniforms(k,a),Oe.refreshMaterialUniforms(k,r,I,oe,x.state.transmissionRenderTarget[e.id]),v.needsLights&&v.lightProbeGrid){let e=v.lightProbeGrid;k.probesSH.value=e.texture,k.probesMin.value.copy(e.boundingBox.min),k.probesMax.value.copy(e.boundingBox.max),k.probesResolution.value.copy(e.resolution)}wi.upload(L,mt(v),k,V)}if(r.isShaderMaterial&&r.uniformsNeedUpdate===!0&&(wi.upload(L,mt(v),k,V),r.uniformsNeedUpdate=!1),r.isSpriteMaterial&&O.setValue(L,`center`,i.center),O.setValue(L,`modelViewMatrix`,i.modelViewMatrix),O.setValue(L,`normalMatrix`,i.normalMatrix),O.setValue(L,`modelMatrix`,i.matrixWorld),r.uniformsGroups!==void 0){let e=r.uniformsGroups;for(let t=0,n=e.length;t<n;t++){let n=e[t];Ve.update(n,S),Ve.bind(n,S)}}return S}function yt(e,t){e.ambientLightColor.needsUpdate=t,e.lightProbe.needsUpdate=t,e.sunLights.needsUpdate=t,e.sunLightShadows.needsUpdate=t,e.directionalLights.needsUpdate=t,e.directionalLightShadows.needsUpdate=t,e.pointLights.needsUpdate=t,e.pointLightShadows.needsUpdate=t,e.spotLights.needsUpdate=t,e.spotLightShadows.needsUpdate=t,e.rectAreaLights.needsUpdate=t,e.hemisphereLights.needsUpdate=t}function bt(e){return e.isMeshLambertMaterial||e.isMeshToonMaterial||e.isMeshPhongMaterial||e.isMeshStandardMaterial||e.isShadowMaterial||e.isShaderMaterial&&e.lights===!0}this.getActiveCubeFace=function(){return j},this.getActiveMipmapLevel=function(){return M},this.getRenderTarget=function(){return N},this.setRenderTargetTextures=function(e,t,n){let r=B.get(e);r.__autoAllocateDepthBuffer=e.resolveDepthBuffer===!1,r.__autoAllocateDepthBuffer===!1&&(r.__useRenderToTexture=!1),B.get(e.texture).__webglTexture=t,B.get(e.depthTexture).__webglTexture=r.__autoAllocateDepthBuffer?void 0:n,r.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(e,t){let n=B.get(e);n.__webglFramebuffer=t,n.__useDefaultFramebuffer=t===void 0},this.setRenderTarget=function(e,t=0,n=0){N=e,j=t,M=n;let r=null,i=!1,a=!1;if(e){let o=B.get(e);if(o.__useDefaultFramebuffer!==void 0){z.bindFramebuffer(L.FRAMEBUFFER,o.__webglFramebuffer),te.copy(e.viewport),ne.copy(e.scissor),re=e.scissorTest,z.viewport(te),z.scissor(ne),z.setScissorTest(re),ee=-1;return}if(o.__webglFramebuffer===void 0)V.setupRenderTarget(e);else if(o.__hasExternalTextures)V.rebindTextures(e,B.get(e.texture).__webglTexture,B.get(e.depthTexture).__webglTexture);else if(e.depthBuffer){let t=e.depthTexture;if(o.__boundDepthTexture!==t){if(t!==null&&B.has(t)&&(e.width!==t.image.width||e.height!==t.image.height))throw Error(`THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.`);V.setupDepthRenderbuffer(e)}}let s=e.texture;(s.isData3DTexture||s.isDataArrayTexture||s.isCompressedArrayTexture)&&(a=!0);let c=B.get(e).__webglFramebuffer;e.isWebGLCubeRenderTarget?(r=Array.isArray(c[t])?c[t][n]:c[t],i=!0):r=e.samples>0&&V.useMultisampledRTT(e)===!1?B.get(e).__webglMultisampledFramebuffer:Array.isArray(c)?c[n]:c,te.copy(e.viewport),ne.copy(e.scissor),re=e.scissorTest}else te.copy(le).multiplyScalar(I).floor(),ne.copy(ue).multiplyScalar(I).floor(),re=de;if(n!==0&&(r=O),z.bindFramebuffer(L.FRAMEBUFFER,r)&&z.drawBuffers(e,r),z.viewport(te),z.scissor(ne),z.setScissorTest(re),i){let r=B.get(e.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_CUBE_MAP_POSITIVE_X+t,r.__webglTexture,n)}else if(a){let r=t;for(let t=0;t<e.textures.length;t++){let i=B.get(e.textures[t]);L.framebufferTextureLayer(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0+t,i.__webglTexture,n,r)}}else if(e!==null&&n!==0){let t=B.get(e.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,t.__webglTexture,n)}ee=-1};function xt(e){let t=B.get(e);return(t.__readFormat!==e.format||t.__readType!==e.type)&&(t.__readFormat=e.format,t.__readType=e.type,t.__formatReadable=Se.textureFormatReadable(e.format),t.__typeReadable=Se.textureTypeReadable(e.type)),t}this.readRenderTargetPixels=function(e,t,n,r,i,a,o,s=0){if(!(e&&e.isWebGLRenderTarget)){U(`WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.`);return}let c=B.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&o!==void 0&&(c=c[o]),c){z.bindFramebuffer(L.FRAMEBUFFER,c);try{let o=e.textures[s],c=o.format,l=o.type;e.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+s);let u=xt(o);if(u.__formatReadable===!1){U(`WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.`);return}if(u.__typeReadable===!1){U(`WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.`);return}t>=0&&t<=e.width-r&&n>=0&&n<=e.height-i&&L.readPixels(t,n,r,i,Be.convert(c),Be.convert(l),a)}finally{let e=N===null?null:B.get(N).__webglFramebuffer;z.bindFramebuffer(L.FRAMEBUFFER,e)}}},this.readRenderTargetPixelsAsync=async function(e,t,n,r,i,a,o,s=0){if(!(e&&e.isWebGLRenderTarget))throw Error(`THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.`);let c=B.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&o!==void 0&&(c=c[o]),c){if(t>=0&&t<=e.width-r&&n>=0&&n<=e.height-i){z.bindFramebuffer(L.FRAMEBUFFER,c);let o=e.textures[s],l=o.format,u=o.type;e.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+s);let d=xt(o);if(d.__formatReadable===!1)throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.`);if(d.__typeReadable===!1)throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.`);let f=L.createBuffer();L.bindBuffer(L.PIXEL_PACK_BUFFER,f),L.bufferData(L.PIXEL_PACK_BUFFER,a.byteLength,L.STREAM_READ),L.readPixels(t,n,r,i,Be.convert(l),Be.convert(u),0),L.bindBuffer(L.PIXEL_PACK_BUFFER,null);let p=N===null?null:B.get(N).__webglFramebuffer;z.bindFramebuffer(L.FRAMEBUFFER,p);let m=L.fenceSync(L.SYNC_GPU_COMMANDS_COMPLETE,0);return L.flush(),await Xe(L,m,4),L.bindBuffer(L.PIXEL_PACK_BUFFER,f),L.getBufferSubData(L.PIXEL_PACK_BUFFER,0,a),L.bindBuffer(L.PIXEL_PACK_BUFFER,null),L.deleteBuffer(f),L.deleteSync(m),a}throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.`)}},this.copyFramebufferToTexture=function(e,t=null,n=0){let r=2**-n,i=Math.floor(e.image.width*r),a=Math.floor(e.image.height*r),o=t===null?0:t.x,s=t===null?0:t.y;V.setTexture2D(e,0),L.copyTexSubImage2D(L.TEXTURE_2D,n,0,0,o,s,i,a),z.unbindTexture()},this.copyTextureToTexture=function(e,t,n=null,r=null,i=0,a=0){let o,s,c,l,u,d,f,p,m,h=e.isCompressedTexture?e.mipmaps[a]:e.image;if(n!==null)o=n.max.x-n.min.x,s=n.max.y-n.min.y,c=n.isBox3?n.max.z-n.min.z:1,l=n.min.x,u=n.min.y,d=n.isBox3?n.min.z:0;else{let t=2**-i;o=Math.floor(h.width*t),s=Math.floor(h.height*t),c=e.isDataArrayTexture?h.depth:e.isData3DTexture?Math.floor(h.depth*t):1,l=0,u=0,d=0}r===null?(f=0,p=0,m=0):(f=r.x,p=r.y,m=r.z);let g=Be.convert(t.format),_=Be.convert(t.type),v;t.isData3DTexture?(V.setTexture3D(t,0),v=L.TEXTURE_3D):t.isDataArrayTexture||t.isCompressedArrayTexture?(V.setTexture2DArray(t,0),v=L.TEXTURE_2D_ARRAY):(V.setTexture2D(t,0),v=L.TEXTURE_2D),z.activeTexture(L.TEXTURE0),z.pixelStorei(L.UNPACK_FLIP_Y_WEBGL,t.flipY),z.pixelStorei(L.UNPACK_PREMULTIPLY_ALPHA_WEBGL,t.premultiplyAlpha),z.pixelStorei(L.UNPACK_ALIGNMENT,t.unpackAlignment);let y=z.getParameter(L.UNPACK_ROW_LENGTH),b=z.getParameter(L.UNPACK_IMAGE_HEIGHT),x=z.getParameter(L.UNPACK_SKIP_PIXELS),S=z.getParameter(L.UNPACK_SKIP_ROWS),C=z.getParameter(L.UNPACK_SKIP_IMAGES);z.pixelStorei(L.UNPACK_ROW_LENGTH,h.width),z.pixelStorei(L.UNPACK_IMAGE_HEIGHT,h.height),z.pixelStorei(L.UNPACK_SKIP_PIXELS,l),z.pixelStorei(L.UNPACK_SKIP_ROWS,u),z.pixelStorei(L.UNPACK_SKIP_IMAGES,d);let w=e.isDataArrayTexture||e.isData3DTexture,T=t.isDataArrayTexture||t.isData3DTexture;if(e.isDepthTexture){let n=B.get(e),r=B.get(t),h=B.get(n.__renderTarget),g=B.get(r.__renderTarget);z.bindFramebuffer(L.READ_FRAMEBUFFER,h.__webglFramebuffer),z.bindFramebuffer(L.DRAW_FRAMEBUFFER,g.__webglFramebuffer);for(let n=0;n<c;n++)w&&(L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,B.get(e).__webglTexture,i,d+n),L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,B.get(t).__webglTexture,a,m+n)),L.blitFramebuffer(l,u,o,s,f,p,o,s,L.DEPTH_BUFFER_BIT,L.NEAREST);z.bindFramebuffer(L.READ_FRAMEBUFFER,null),z.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else if(i!==0||e.isRenderTargetTexture||B.has(e)){let n=B.get(e),r=B.get(t);z.bindFramebuffer(L.READ_FRAMEBUFFER,k),z.bindFramebuffer(L.DRAW_FRAMEBUFFER,A);for(let e=0;e<c;e++)w?L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,n.__webglTexture,i,d+e):L.framebufferTexture2D(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,n.__webglTexture,i),T?L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,r.__webglTexture,a,m+e):L.framebufferTexture2D(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,r.__webglTexture,a),i===0?T?L.copyTexSubImage3D(v,a,f,p,m+e,l,u,o,s):L.copyTexSubImage2D(v,a,f,p,l,u,o,s):L.blitFramebuffer(l,u,o,s,f,p,o,s,L.COLOR_BUFFER_BIT,L.NEAREST);z.bindFramebuffer(L.READ_FRAMEBUFFER,null),z.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else T?e.isDataTexture||e.isData3DTexture?L.texSubImage3D(v,a,f,p,m,o,s,c,g,_,h.data):t.isCompressedArrayTexture?L.compressedTexSubImage3D(v,a,f,p,m,o,s,c,g,h.data):L.texSubImage3D(v,a,f,p,m,o,s,c,g,_,h):e.isDataTexture?L.texSubImage2D(L.TEXTURE_2D,a,f,p,o,s,g,_,h.data):e.isCompressedTexture?L.compressedTexSubImage2D(L.TEXTURE_2D,a,f,p,h.width,h.height,g,h.data):L.texSubImage2D(L.TEXTURE_2D,a,f,p,o,s,g,_,h);z.pixelStorei(L.UNPACK_ROW_LENGTH,y),z.pixelStorei(L.UNPACK_IMAGE_HEIGHT,b),z.pixelStorei(L.UNPACK_SKIP_PIXELS,x),z.pixelStorei(L.UNPACK_SKIP_ROWS,S),z.pixelStorei(L.UNPACK_SKIP_IMAGES,C),a===0&&t.generateMipmaps&&L.generateMipmap(v),z.unbindTexture()},this.initRenderTarget=function(e){B.get(e).__webglFramebuffer===void 0&&V.setupRenderTarget(e)},this.initTexture=function(e){e.isCubeTexture?V.setTextureCube(e,0):e.isData3DTexture?V.setTexture3D(e,0):e.isDataArrayTexture||e.isCompressedArrayTexture?V.setTexture2DArray(e,0):V.setTexture2D(e,0),z.unbindTexture()},this.resetState=function(){j=0,M=0,N=null,z.reset(),W.reset()},typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`observe`,{detail:this}))}get coordinateSystem(){return on}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=Ct._getDrawingBufferColorSpace(e),t.unpackColorSpace=Ct._getUnpackColorSpace()}};function qa(e,t){let n=Math.max(Math.min(...e.map(e=>e[0])),Math.min(Math.max(...e.map(e=>e[0])),t)),r=1/0;for(let t of e)for(let i of e){if(Math.abs(t[0]-i[0])<1e-7){Math.abs(n-t[0])<1e-7&&(r=Math.min(r,t[1],i[1]));continue}let e=(n-t[0])/(i[0]-t[0]);e>=0&&e<=1&&(r=Math.min(r,t[1]+(i[1]-t[1])*e))}return r}var Ja=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],Ya=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],Xa=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2];function Za(e,t,n,r,i){let a=Ja(r,n),o=Ja(i,n),s=Ya(t,o),c=Xa(a,s);if(Math.abs(c)<1e-8)return!1;let l=Ja(e,n),u=Xa(l,s)/c;if(u<0||u>1)return!1;let d=Ya(l,a),f=Xa(t,d)/c;return f>=0&&u+f<=1&&Xa(o,d)/c>.03}var Qa=null;function $a(e){Qa??=F().paintedVolume.vertices[0];let t=e.vertices[0];return[ve[0]+t[0]-Qa[0],ve[1]+t[1]-Qa[1]]}var eo=class{near=!1;clearFrames=new Map;update(e,t,n,r,i,a,o){if(e!==de.id)return new Set;let s=$a(t),c=Math.hypot(n[0]-s[0],n[1]-s[1]);if(this.near=c<=(this.near?12:10),!this.near)return this.clearFrames.clear(),new Set;let l=[];for(let e of[-.5,-.25,0,.25,.5])for(let t of[.03,.25,.5,.75,.99])l.push([n[0]+i[0]*e*(a+.4),n[1]+i[1]*e*(a+.4),t*o]);for(let e of t.faces){if(e.part!==`ka-pilot`)continue;let n=hn(t,e),i=e=>[n.positions[e*3],n.positions[e*3+1],n.positions[e*3+2]],a=!1;for(let e=0;e<n.indices.length&&!a;e+=3){let t=i(n.indices[e]),o=i(n.indices[e+1]),s=i(n.indices[e+2]);a=l.some(e=>Za(e,r,t,o,s))}if(a)this.clearFrames.set(e.id,0);else if(this.clearFrames.has(e.id)){let t=this.clearFrames.get(e.id)+1;t>=2?this.clearFrames.delete(e.id):this.clearFrames.set(e.id,t)}}return new Set(this.clearFrames.keys())}};function to(e,t){let n=[],r=[1/0,1/0,1/0],i=[-1/0,-1/0,-1/0];for(let e of t.faces){let a=hn(t,e,1);for(let e of a.indices)for(let t=0;t<3;t++){let o=a.positions[e*3+t];n.push(o),r[t]=Math.min(r[t],o),i[t]=Math.max(i[t],o)}}return{id:e,min:r,max:i,triangles:Float32Array.from(n)}}function no(e,t,n,r){let i=0,a=1;for(let o=0;o<3;o++){let s=e[o],c=t[o];if(Math.abs(c)<1e-9){if(s<n[o]||s>r[o])return!1;continue}let l=(n[o]-s)/c,u=(r[o]-s)/c;if(l>u&&([l,u]=[u,l]),i=Math.max(i,l),a=Math.min(a,u),i>a)return!1}return!0}function ro(e,t,n,r){let i=n[r],a=n[r+1],o=n[r+2],s=n[r+3]-i,c=n[r+4]-a,l=n[r+5]-o,u=n[r+6]-i,d=n[r+7]-a,f=n[r+8]-o,p=t[1]*f-t[2]*d,m=t[2]*u-t[0]*f,h=t[0]*d-t[1]*u,g=s*p+c*m+l*h;if(Math.abs(g)<1e-12)return!1;let _=e[0]-i,v=e[1]-a,y=e[2]-o,b=(_*p+v*m+y*h)/g;if(b<0||b>1)return!1;let x=v*l-y*c,S=y*s-_*l,C=_*c-v*s,w=(t[0]*x+t[1]*S+t[2]*C)/g;if(w<0||b+w>1)return!1;let T=(u*x+d*S+f*C)/g;return T>.02&&T<1}function io(e,t,n){let r=0,i=0;for(let a of[-.35,-.175,0,.175,.35])for(let o of[.12,.4,.65,.9]){i++;let s=[t.point[0]+t.right[0]*a*t.width,t.point[1]+t.right[1]*a*t.width,o*t.height],c=[n[0]-s[0],n[1]-s[1],n[2]-s[2]];for(let t of e){if(!no(s,c,t.min,t.max))continue;let e=!1;for(let n=0;n<t.triangles.length&&!e;n+=9)e=ro(s,c,t.triangles,n);if(e){r++;break}}}return r/i}var ao=class{root=new Ye;parcels=new Ye;constructor(){let e=le.route.flatMap(e=>[e[0],e[1],.08]),t=new _t;t.setAttribute(`position`,new Re(e,3));let n=new Ue(t,new Je({color:2396136}));n.renderOrder=-(2**53-1)+9,this.root.add(n),this.root.visible=!1;for(let e of le.route.slice(0,-1)){let t=new q(new bt(1.5,20),new We({color:2396136,side:2}));t.position.set(e[0],e[1],.09),t.renderOrder=-(2**53-1)+9,this.root.add(t)}for(let e of le.greenParcels)for(let t=0;t<e.polygon.length;t++){let n=e.polygon[t],r=e.polygon[(t+1)%e.polygon.length],i=r[0]-n[0],a=r[1]-n[1],o=new q(new Yt(Math.hypot(i,a),.5,.18),new We({color:l.villageStone}));o.position.set((n[0]+r[0])/2,(n[1]+r[1])/2,.1),o.rotation.z=Math.atan2(a,i),o.renderOrder=-(2**53-1)+9,this.parcels.add(o)}this.parcels.visible=!1}dispose(){for(let e of[this.root,this.parcels])e.traverse(e=>{(e instanceof q||e instanceof Ue)&&(e.geometry.dispose(),e.material.dispose())}),e.removeFromParent()}},oo=()=>{},so=class{saved=new Map;marked=new Set;suppress(e){this.marked.add(e),!this.saved.has(e)&&(this.saved.set(e,[e.renderWebGL,e.renderCanvas]),e.renderWebGL=oo,e.renderCanvas=oo)}settle(){for(let[e,[t,n]]of this.saved)this.marked.has(e)||(e.renderWebGL=t,e.renderCanvas=n,this.saved.delete(e));this.marked.clear()}restoreAll(){for(let[e,[t,n]]of this.saved)e.renderWebGL=t,e.renderCanvas=n;this.saved.clear(),this.marked.clear()}has(e){return this.saved.has(e)}},co=e(r(),1),lo=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`,uo=`
uniform sampler2D tTown;
uniform float uAlpha;
varying vec2 vUv;
${b}
void main() {
  gl_FragColor = vec4(decisiveFrame(tTown, vUv, gl_FragCoord.xy), uAlpha);
}`,fo=e=>new Z(...y(e)),po=class{t;texture=null;scene=new Ut;camera=new Wt(-1,1,1,-1,0,1);material;quad;size=new X;constructor(e=g.feel.screenGrade){this.t=e,this.material=new J({vertexShader:lo,fragmentShader:uo,uniforms:{tTown:{value:null},uMode:{value:0},uAlpha:{value:0},uPitch:{value:6},uSteps:{value:3},uSolid:{value:0},uBlur:{value:0},uCenter:{value:new X(.5,.5)},uInk:{value:fo(l.webtoonInk)},uPaper:{value:fo(l.paper)},uSilhouette:{value:new Z(0,1,0)},uSilInk:{value:fo(l.navyInk)},uNightTime:{value:0},uNightGrid:{value:new K(3,26,46,22)},uNightDeep:{value:fo(C.deep)},uNightHigh:{value:fo(C.high)},uNightCloud:{value:fo(C.cloud)},uNightStar:{value:fo(C.star)}},transparent:!0,depthTest:!1,depthWrite:!1}),this.quad=new q(new vt(2,2),this.material),this.quad.frustumCulled=!1,this.scene.add(this.quad)}warm(e){e.compileAsync(this.scene,this.camera).catch(()=>void 0)}render(e,t,n,r,i=0){e.getDrawingBufferSize(this.size);let a=this.texture?.image;(!this.texture||a?.width!==this.size.x||a?.height!==this.size.y)&&(this.texture?.dispose(),this.texture=new It(this.size.x,this.size.y),this.texture.minFilter=cn,this.texture.magFilter=cn),e.copyFramebufferToTexture(this.texture);let o=this.material.uniforms,s=this.t.backdrop;o.tTown.value=this.texture,o.uMode.value=v[t],o.uAlpha.value=n,o.uPitch.value=s.screentone.pitchPx*e.getPixelRatio(),o.uSteps.value=Math.max(1,s.negative.steps),o.uSolid.value=s.screentone.solidBelow,o.uBlur.value=s.screentone.zoomBlur,o.uSilhouette.value.set(s.silhouette.from,s.silhouette.to,s.silhouette.lift),o.uCenter.value.copy(r);let c=e.getPixelRatio(),l=x;o.uNightTime.value=i/1e3,o.uNightGrid.value.set(l.ditherPx*c,l.blockPx*c,l.starCellPx*c,l.driftPxPerSec*c);let u=e.autoClear;e.autoClear=!1,e.render(this.scene,this.camera),e.autoClear=u}dispose(){this.texture?.dispose(),this.quad.geometry.dispose(),this.material.dispose()}};async function mo(e){let{red:t,width:n,height:r}=await yo(e),i=new yt(t,n,r,qe,en);return i.colorSpace=``,i.generateMipmaps=!1,i.minFilter=i.magFilter=cn,i.needsUpdate=!0,i}var ho,go=0,_o=new Map;function vo(){if(ho!==void 0)return ho;try{ho=new Worker(new URL(`/assets/CityScalarDecode.worker-B1OGsAbq.js`,``+import.meta.url),{type:`module`}),ho.onmessage=e=>{let t=e.data,n=_o.get(t.id);n&&(_o.delete(t.id),`error`in t?n.reject(Error(t.error)):n.resolve(t))},ho.onerror=()=>{for(let e of _o.values())e.reject(Error(`city scalar worker failed`));_o.clear(),ho?.terminate(),ho=null}}catch{ho=null}return ho}async function yo(e){let t=vo();if(t===null)return bo(e);let{width:n,height:r}=e,i=go++;return new Promise((n,r)=>{_o.set(i,{resolve:n,reject:r}),t.postMessage({id:i,bitmap:e},[e])}).then(e=>e.width===n&&e.height===r?e:Promise.reject(Error(`city scalar size mismatch`)))}function bo(e){let{width:t,height:n}=e,r=new OffscreenCanvas(t,n).getContext(`2d`);if(!r)throw Error(`City visibility decode requires a 2D context`);r.drawImage(e,0,0),e.close();let i=r.getImageData(0,0,t,n).data,a=new Uint8Array(t*n);for(let e=0;e<a.length;e++)a[e]=i[e*4];return{red:a,width:t,height:n}}var xo=class{world;mesh;constructor(e,t){this.world=e;let[n,r,i,a]=P.bounds,o=new J({uniforms:{groundShadow:{value:t},ink:{value:new Y(l.cityNprCastInk)}},vertexShader:`varying vec2 at;void main(){at=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform sampler2D groundShadow;uniform vec3 ink;varying vec2 at;
        void main(){gl_FragColor=vec4(ink,texture2D(groundShadow,at).r);
          #include <colorspace_fragment>
        }`,transparent:!1,depthTest:!1,depthWrite:!1,side:2,blending:5,blendSrc:204,blendDst:205,blendSrcAlpha:201,blendDstAlpha:205});this.mesh=new q(new vt(i-n,a-r),o),this.mesh.name=`city-baked-ground-shadow`,this.mesh.geometry.getAttribute(`uv`).array.set([0,0,1,0,0,1,1,1]),this.mesh.position.set((n+i)/2,(r+a)/2,.027),this.mesh.renderOrder=-(2**53-1)+8,this.mesh.updateMatrix(),this.mesh.matrixAutoUpdate=!1,e.add(this.mesh)}update(e){this.mesh.visible=e}dispose(){this.world.remove(this.mesh),this.mesh.geometry.dispose(),this.mesh.material.dispose()}},So=[[.015,.17,.22,0],[.14,.095,.16,3],[.25,.28,.25,1],[.265,.085,.17,2],[.37,.12,.2,0],[.49,.21,.24,2],[.62,.09,.16,3],[.73,.25,.24,1],[.86,.13,.21,2],[.95,.37,.18,3]].map(([e,t,n,r])=>{let i=(e-.5)*Math.PI*2,a=Math.cos(i),o=Math.sin(i),s=Math.cos(t),c=Math.sin(t);return{center:new Z(s*a,s*o,c),right:new Z(-o,a,0).multiplyScalar(1/n),up:new Z(-c*a,-c*o,s).multiplyScalar(2/n),frame:new K(r%2/2,r<2?.5:0,.5,.5)}}),Co=d.camera.skyOrthographicFov,wo=Math.tan(Co*Math.PI/360);function To(e,t,n=new W){if(!Number.isFinite(t)||t<=0)throw Error(`Invalid city sky aspect`);let r=e.elements;for(let e of r)if(!Number.isFinite(e))throw Error(`Invalid city sky projection`);let i=Math.hypot(r[0],r[4],r[8]),a=Math.hypot(r[1],r[5],r[9]),o=Math.hypot(r[3],r[7],r[11]);if(!i||!a)throw Error(`Degenerate city sky projection`);if(o>0){if(n.set(r[0]/i,r[4]/i,r[8]/i,r[1]/a,r[5]/a,r[9]/a,r[3]/o,r[7]/o,r[11]/o),!n.determinant())throw Error(`Degenerate city sky perspective`);n.invert();let e=n.elements;for(let t=0;t<3;t++)e[t]=e[t]*(o/i),e[t+3]=e[t+3]*(o/a);return n}let s=Math.hypot(r[2],r[6],r[10]);if(!s)throw Error(`Degenerate city sky orthographic projection`);let c=wo*t;return n.set(r[0]/i*c,r[1]/a*wo,r[2]/s,r[4]/i*c,r[5]/a*wo,r[6]/s,r[8]/i*c,r[9]/a*wo,r[10]/s)}var Eo=d.sky.cloudTurnsPerMs,Do=class{clouds=new yt(new Uint8Array(4),1,1,Dt);viewport=new K;mesh;constructor(e=l.cityDaySkyHorizon){this.clouds.needsUpdate=!0,this.mesh=new q(new vt(2,2),new J({depthTest:!1,depthWrite:!1,toneMapped:!1,uniforms:{skyDirection:{value:new W},clouds:{value:this.clouds},cloudOffset:{value:0},cloudCenters:{value:So.map(e=>e.center)},cloudRights:{value:So.map(e=>e.right)},cloudUps:{value:So.map(e=>e.up)},cloudFrames:{value:So.map(e=>e.frame)},zenith:{value:new Y(l.cityDaySkyZenith)},horizon:{value:new Y(l.cityDaySkyHorizon)},lowerHemisphereColor:{value:new Y(e)}},vertexShader:`varying vec2 skyNdc;
        void main() { skyNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`,fragmentShader:`
        uniform mat3 skyDirection;
        uniform sampler2D clouds;
        uniform float cloudOffset;
        const int CLOUD_COUNT = ${So.length};
        uniform vec3 cloudCenters[CLOUD_COUNT], cloudRights[CLOUD_COUNT], cloudUps[CLOUD_COUNT];
        uniform vec4 cloudFrames[CLOUD_COUNT];
        uniform vec3 zenith; uniform vec3 horizon;
        uniform vec3 lowerHemisphereColor;
        varying vec2 skyNdc;
        void main() {
          vec3 ray = normalize(skyDirection * vec3(skyNdc, 1.0));
          // The city uses XY ground and Z up.
          float elevation = asin(clamp(ray.z, -1.0, 1.0));
          vec3 color = mix(horizon, zenith, smoothstep(0.0, .22, max(elevation, 0.0)));
          // Registered coastal land exposes the sea-colored background below the horizon.
          // This is a distant background approximation, not water geometry or a camera change.
          color = mix(lowerHemisphereColor, color, smoothstep(-.08, 0.0, elevation));
          float drift = cloudOffset * 6.28318530718;
          float c = cos(drift), s = sin(drift);
          vec3 cloudRay = vec3(c * ray.x - s * ray.y, s * ray.x + c * ray.y, ray.z);
          for (int i = 0; i < CLOUD_COUNT; i++) {
            float facing = dot(cloudRay, cloudCenters[i]);
            vec2 local = vec2(dot(cloudRay, cloudRights[i]), dot(cloudRay, cloudUps[i])) / max(facing, .001);
            vec2 uv = cloudFrames[i].xy + (local * .5 + .5) * cloudFrames[i].zw;
            // Derivatives are evaluated before the branch so mip selection stays valid at card edges.
            vec2 dx = dFdx(uv), dy = dFdy(uv);
            if (facing > 0.0 && max(abs(local.x), abs(local.y)) < 1.0) {
              vec4 cloud = textureGrad(clouds, uv, dx, dy);
              color = mix(color, cloud.rgb, cloud.a * smoothstep(.015, .065, elevation));
            }
          }
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`})),this.mesh.name=`native-city-day-sky`,this.mesh.frustumCulled=!1,this.mesh.renderOrder=-(2**53-1),this.mesh.onBeforeRender=(e,t,n)=>{e.getViewport(this.viewport),To(n.projectionMatrix,this.viewport.z/Math.max(1,this.viewport.w),this.mesh.material.uniforms.skyDirection.value)}}setCloudTexture(e){this.mesh.material.uniforms.clouds.value=e}update(e,t,n){if(!n||t||!Number.isFinite(e))return;let r=this.mesh.material.uniforms.cloudOffset;r.value=(r.value+Math.max(0,Math.min(e,100))*Eo)%1}dispose(){this.mesh.removeFromParent(),this.mesh.geometry.dispose(),this.mesh.material.dispose(),this.clouds.dispose()}},Oo=e=>{let t=Math.max(0,Math.min(1,e));return t*t*(3-2*t)},ko=(e,t,n)=>e+(t-e)*n;function Ao(e){return(e.mapping===void 0||e.mapping===`continuous`)&&e.imageSize.length===2&&e.imageSize.every(e=>Number.isFinite(e)&&e>0)&&Number.isFinite(e.heightScale)&&e.heightScale>0&&e.imageCorners.length===3&&e.planCorners.length===3&&[...e.imageCorners,...e.planCorners].every(e=>e.length===2&&e.every(Number.isFinite))&&e.imageCorners.every(t=>t[0]>=0&&t[1]>=0&&t[0]<=e.imageSize[0]&&t[1]<=e.imageSize[1])&&(e.mapping!==`continuous`||Math.abs((e.imageCorners[1][0]-e.imageCorners[0][0])*(e.imageCorners[2][1]-e.imageCorners[0][1])-(e.imageCorners[1][1]-e.imageCorners[0][1])*(e.imageCorners[2][0]-e.imageCorners[0][0]))>1e-6)&&e.imageCorners[0][0]<e.imageCorners[1][0]&&e.imageCorners[1][0]<e.imageCorners[2][0]}function jo(e,t,n){let r=e[1][0]-e[0][0],i=e[1][1]-e[0][1],a=e[2][0]-e[0][0],o=e[2][1]-e[0][1],s=r*o-i*a,c=n[0]-e[0][0],l=n[1]-e[0][1],u=(c*o-l*a)/s,d=(r*l-i*c)/s;return[0,1].map(e=>t[0][e]+u*(t[1][e]-t[0][e])+d*(t[2][e]-t[0][e]))}function Mo(e,t){let[n,r,i]=t;if(e.mapping!==`continuous`||n[0]+.00101>=r[0]||r[0]+.00101>=i[0]||Math.abs((r[0]-n[0])*(i[1]-n[1])-(r[1]-n[1])*(i[0]-n[0]))<=1e-6)return!1;let a=jo(e.imageCorners,t,[0,0]),o=jo(e.imageCorners,t,[0,300]);return Math.abs(o[0]-a[0])<=1}function No(e,t){return t<=e[1][0]?0:1}function Po(e,t){let n=No(e,t),r=e[n],i=e[n+1];return ko(r[1],i[1],(t-r[0])/(i[0]-r[0]))}function Fo(e,t,n){if(Mo(e,t))return jo(e.imageCorners,t,n);let r=No(e.imageCorners,n[0]),i=e.imageCorners[r],a=e.imageCorners[r+1],o=ko(t[r][0],t[r+1][0],(n[0]-i[0])/(a[0]-i[0]));return[o,Po(t,o)+e.heightScale*(n[1]-Po(e.imageCorners,n[0]))]}function Io(e,t,n){if(!Ao(e))return null;let r=e.planCorners.map(([e,r])=>[n.x[0]*(e-t[0])+n.y[0]*(r-t[1]),n.x[1]*(e-t[0])+n.y[1]*(r-t[1])]),i=[r[1][0]-r[0][0],r[2][0]-r[1][0]];if(i.some(e=>e<-2)||i.every(e=>e<=0))return null;let a=i[0]<0?0:i[1]<0?1:-1,o=[[Math.min(r[0][0],r[1][0]-.001),r[0][1]],r[1],[Math.max(r[2][0],r[1][0]+.001),r[2][1]]],s=[0,1].map(t=>(o[t+1][0]-o[t][0])/(e.imageCorners[t+1][0]-e.imageCorners[t][0])/e.heightScale),c=.001+.999*Oo((Math.min(...s)-.03)/.15),l=[0,e.imageCorners[1][0],e.imageSize[0]].flatMap(t=>[0,e.imageSize[1]].map(n=>Fo(e,o,[t,n]))),u=Math.min(...l.map(e=>e[0])),d=Math.min(...l.map(e=>e[1])),f=Math.max(...l.map(e=>e[0])),p=Math.max(...l.map(e=>e[1])),m=Math.max(...e.imageCorners.map((t,n)=>{if(a===0&&n===0||a===1&&n===2)return 0;let i=Fo(e,o,t);return Math.hypot(i[0]-r[n][0],i[1]-r[n][1])})),h;if(a===-1&&Mo(e,o)){let t=jo(o,e.imageCorners,[0,0]),n=jo(o,e.imageCorners,[1,0]),r=jo(o,e.imageCorners,[0,1]);h=[[n[0]-t[0],r[0]-t[0],t[0]],[n[1]-t[1],r[1]-t[1],t[1]]]}return{source:e,target:o,facing:c,maxError:m,bounds:[u,d,f,p],omittedSide:a,...h?{inverseRows:h}:{}}}var Lo={castStrength:.4,contactStrength:.24,bounceStrength:.045,shadowTransmission:[.72,.78,.9]},Ro=`
 vec3 shopBakedLighting(vec3 color,vec3 lighting){
  float castAmount=(1.-clamp(lighting.r,0.,1.))*${Lo.castStrength};
  float contact=1.-(1.-clamp(lighting.g,0.,1.))*${Lo.contactStrength};
  return color*((vec3(1.)-castAmount*(vec3(2.)-vec3(${Lo.shadowTransmission.join(`,`)})))*contact+clamp(lighting.b,0.,1.)*${Lo.bounceStrength});
 }
`;function zo(e,t,n,r,i,a){let o=i?.uvByFace[t.id],s=t.surface?.normals,c=Array.from({length:32},()=>new K),u=Array.from({length:4},()=>new X),d=0;for(let[e,n]of(t.clipContours??[]).entries()){if(e>=4||d+n.length>32)throw Error(`Painted face clip exceeds budget: ${t.id}`);u[e].set(d,n.length);for(let[e,t]of n.entries()){let r=n[(e+1)%n.length];c[d++].set(...t,...r)}}let f=s?`nprSurfaceNormal`:`normalWorld`,p=s?`nprSurfaceSunlight`:`sunlight`,m=`gl_FragColor.rgb=cityNprLighting(gl_FragColor.rgb,${f},${p},1.,1.,paintKind)*shade;`,h=new J({transparent:!t.opaqueCutout,depthWrite:!0,side:2,uniforms:{image:{value:n},alphaCutoff:{value:t.alphaCutoff??.15},opaqueCutout:{value:+!!t.opaqueCutout},contourCount:{value:t.clipContours?.length??0},clipEdges:{value:c},clipRanges:{value:u},saturation:{value:Sn(t)},shade:{value:t.shade??1},imageSize:{value:new X(...t.imageSize)},nprDebug:{value:0},normalWorld:{value:new Z(...fn(e,t))},sunlight:{value:V(fn(e,t))},...s?{sunDirection:{value:new Z(...Te())}}:{},paintKind:{value:wn(t)},distanceMix:{value:0},distanceColor:{value:new Y(l.cityDaySkyHorizon)}},vertexShader:s?`attribute vec3 surfaceNormalWorld;varying vec2 at;varying vec3 interpolatedNormalWorld;void main(){at=uv;interpolatedNormalWorld=surfaceNormalWorld;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`:`varying vec2 at; void main(){at=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,fragmentShader:`uniform sampler2D image; uniform float alphaCutoff; uniform float opaqueCutout; uniform float contourCount; uniform vec4 clipEdges[32];
      uniform float distanceMix;uniform vec3 distanceColor;
      uniform vec2 clipRanges[4]; uniform vec2 imageSize; uniform float shade; uniform float saturation; varying vec2 at;
      ${s?`varying vec3 interpolatedNormalWorld;`:``}
      ${s?`uniform vec3 sunDirection;`:``}
      uniform float paintKind;
      ${je}
      ${Ee}
      ${Ae}
      uniform vec3 normalWorld;uniform float sunlight;
      void main(){
        if(contourCount>0.5){
          vec2 p=vec2(at.x,1.0-at.y)*imageSize;
          bool keep=false;
          for(int group=0;group<4;group++){
            if(float(group)>=contourCount)break;
            bool inside=false;vec2 range=clipRanges[group];
            for(int i=0;i<32;i++){
              if(float(i)<range.x||float(i)>=range.x+range.y)continue;
              vec4 edge=clipEdges[i];vec2 a=edge.xy,b=edge.zw;
              if((a.y>p.y)!=(b.y>p.y)){
                if(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
              }
            }
            keep=keep||inside;
          }
          if(!keep)discard;
        }
        gl_FragColor=texture2D(image,at);if(gl_FragColor.a<alphaCutoff)discard;if(opaqueCutout>0.5)gl_FragColor.a=1.;
        float paintedLuma=dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722));
        gl_FragColor.rgb=cityBuildingGrade(gl_FragColor.rgb,paintKind);
        gl_FragColor.rgb=mix(vec3(dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722))),gl_FragColor.rgb,saturation);
        ${s?`vec3 nprSurfaceNormal=normalize(interpolatedNormalWorld);float nprSurfaceSunlight=max(0.,dot(nprSurfaceNormal,sunDirection));`:``}
        ${m}
        if(nprDebug<.5){${Oe}}
        #include <colorspace_fragment>
      }`});if(t.part===`ka-pilot`&&(h.uniforms.pilotCutaway={value:0},h.uniforms.pilotActorImage={value:n},h.uniforms.pilotActorRect={value:new K},h.uniforms.pilotActorUv={value:new K},h.uniforms.pilotCutawayFloor={value:new X},h.fragmentShader=`uniform float pilotCutaway;uniform sampler2D pilotActorImage;uniform vec4 pilotActorRect;uniform vec4 pilotActorUv;uniform vec2 pilotCutawayFloor;`+h.fragmentShader.replace(`gl_FragColor=texture2D(image,at);if(gl_FragColor.a<alphaCutoff)discard;if(opaqueCutout>0.5)gl_FragColor.a=1.;`,`gl_FragColor=texture2D(image,at);if(gl_FragColor.a<alphaCutoff)discard;if(opaqueCutout>0.5)gl_FragColor.a=1.;
          if(pilotCutaway>.5){
            // Keep the structure visible and fade only around the body, not down to a remote face floor.
            vec2 lo=pilotActorRect.xy-4.;
            vec2 hi=pilotActorRect.xy+pilotActorRect.zw+4.;
            float radius=min(24.,(hi.x-lo.x)*.5);
            vec2 q=abs(gl_FragCoord.xy-(hi+lo)*.5)-(hi-lo)*.5+radius;
            float edge=length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
            gl_FragColor.a*=mix(.32,1.,smoothstep(-14.,14.,edge));
          }`)),dn(t)===`wall`&&!o&&(h.uniforms.wallHeight={value:mn(e,t)},h.uniforms.wallSpan={value:new K(...pn(e,t))},h.vertexShader=(s?`attribute vec3 surfaceNormalWorld;varying vec3 interpolatedNormalWorld;`:``)+`varying vec2 at;varying vec3 wallPoint;void main(){at=uv;wallPoint=position;`+(s?`interpolatedNormalWorld=surfaceNormalWorld;`:``)+`gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,h.fragmentShader=`uniform float wallHeight;uniform vec4 wallSpan;varying vec3 wallPoint;`+h.fragmentShader.replace(m,`float corner=min(dot(wallPoint.xy,wallSpan.xy)-wallSpan.z,wallSpan.w-dot(wallPoint.xy,wallSpan.xy));
       float occlusion=cityWallRelief(wallPoint.z,wallHeight,corner,paintedLuma);
       gl_FragColor.rgb=cityNprWallEdge(cityNprLighting(gl_FragColor.rgb,${f},${p},1.,occlusion,paintKind)*shade,corner);`)),o&&i&&(h.uniforms.bakedLighting={value:r.get(i.path)},h.vertexShader=`attribute vec2 lightUv;varying vec2 bakedAt;`+h.vertexShader.replace(`at=uv;`,`at=uv;bakedAt=lightUv;`),h.fragmentShader=`uniform sampler2D bakedLighting;varying vec2 bakedAt;`+Ro+h.fragmentShader.replace(Oe,`gl_FragColor.rgb=shopBakedLighting(gl_FragColor.rgb,texture2D(bakedLighting,bakedAt).rgb);`+Oe)),a){let e=Cn(h.vertexShader,h.fragmentShader,a);h.vertexShader=e.vertexShader,h.fragmentShader=e.fragmentShader;for(let e of[`alphaCutoff`,`shade`,`saturation`,`paintKind`,`normalWorld`,`sunlight`,`wallHeight`,`wallSpan`])delete h.uniforms[e];Object.assign(h.uniforms,vn())}return h}var Bo=Object.freeze({pavingPaperMix:.12}),Vo=16;function Ho(e){return Array.from({length:Vo},(t,n)=>new X(...e[n]??[0,0]))}function Uo(e,t){!(e instanceof J)||!e.uniforms.routePoints||(e.uniforms.routePoints.value=Ho(t.points),e.uniforms.routeCount.value=Math.min(t.points.length,Vo),e.uniforms.dialogueCenter.value.set(...t.dialogueCenter))}function Wo(e,t,n,r){let i=t.get(e.path),a=e.materials;if(!a)return new We({map:i,side:2,depthTest:!1,depthWrite:!1});let o=t.get(a.maskPath);o.colorSpace=``,o.minFilter=o.magFilter=cn,o.generateMipmaps=!1,o.needsUpdate=!0;let s=t.get(_e.maskPath)??new yt(new Uint8Array(4),1,1,1023);s.colorSpace=``,s.minFilter=s.magFilter=cn,s.generateMipmaps=!1,s.needsUpdate=!0;let[c,u,d,f]=_e.bounds;for(let e of[a.stonePath,a.meadowPath]){let n=t.get(e);n.wrapS=n.wrapT=mt,n.needsUpdate=!0}let[p,m,h,g]=e.bounds;return new J({side:2,transparent:!1,depthTest:!1,depthWrite:!1,uniforms:{groundBase:{value:i},materialMask:{value:o},compositionMask:{value:s},compositionEnabled:{value:n&&!e.registeredCityPlan?1:0},compositionBounds:{value:new K(c,u,d-c,f-u)},stone:{value:t.get(a.stonePath)},meadow:{value:t.get(a.meadowPath)},plaza:{value:t.get(a.plazaPath)},groundBounds:{value:new K(p,m,h-p,g-m)},repeats:{value:new X(H.ground.stoneRepeatPlan,a.meadowRepeat)},stoneOrigin:{value:new X(...a.stoneFrame.origin)},stoneBasis:{value:new K(...a.stoneFrame.uvFromPlan)},plazaCenter:{value:new X(...a.plazaAnchor)},plazaRadius:{value:a.plazaRadius},plazaFeather:{value:a.plazaFeather},pavingPaper:{value:new Y(l.villagePavingPaper)},pavingPaperMix:{value:Bo.pavingPaperMix},edgeFinish:{value:new Z(H.ground.edgeWidthPlan,H.ground.edgeContact,H.ground.edgeRim)},artFinish:{value:new K(H.ground.patchScale,H.ground.patchStrength,H.ground.detailContrast,H.ground.warmMix)},grassVariation:{value:H.ground.grassStrength},meadowPaint:{value:new Y(l.villageMeadowPaint)},meadowFinish:{value:new X(H.ground.grassDetailContrast,H.ground.grassBlendScale)},pavingSaturation:{value:H.ground.saturation},edgeGrowth:{value:H.ground.edgeGrowth},groundWeather:{value:new Z(H.ground.weatherScale,H.ground.weatherStrength,H.ground.edgeSoil)},groundSoil:{value:new Y(l.villageStone)},streetPaving:{value:new K(+!!e.registeredCityPlan,H.paving.roadRepeatRatio,H.paving.roadShade,H.paving.curbWidth)},curbPaperMix:{value:H.paving.curbPaperMix},dialogueCenter:{value:new X(...r.dialogueCenter)},routePoints:{value:Ho(r.points)},routeCount:{value:Math.min(r.points.length,Vo)},routeFinish:{value:new K(me.dialogueRadius,me.routeHalfWidth,me.detailSoftening,me.paperMix)},distanceFocus:{value:new X},distanceViewDepth:{value:new X(0,-1)},distanceColor:{value:new Y(l.cityDaySkyHorizon)}},vertexShader:`varying vec2 groundUv; varying vec2 groundPlan; void main(){ groundUv=uv; groundPlan=(modelMatrix*vec4(position,1.0)).xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,fragmentShader:`
      uniform sampler2D groundBase; uniform sampler2D materialMask; uniform sampler2D stone; uniform sampler2D meadow; uniform sampler2D plaza;
      uniform vec4 groundBounds; uniform vec2 repeats; uniform vec2 plazaCenter; uniform float plazaRadius; uniform float plazaFeather;
      uniform vec2 stoneOrigin; uniform vec4 stoneBasis;
      uniform vec3 pavingPaper; uniform float pavingPaperMix; uniform vec3 edgeFinish;
      uniform vec4 artFinish;uniform float grassVariation;uniform float edgeGrowth;uniform float pavingSaturation;
      uniform vec3 meadowPaint;uniform vec2 meadowFinish;
      uniform vec3 groundWeather;uniform vec3 groundSoil;
      uniform vec4 streetPaving;uniform float curbPaperMix;
      uniform vec2 dialogueCenter;uniform vec2 routePoints[16];uniform int routeCount;uniform vec4 routeFinish;
      varying vec2 groundUv; varying vec2 groundPlan;
      uniform vec2 distanceFocus; uniform vec2 distanceViewDepth; uniform vec3 distanceColor;
      ${Ae}
      uniform sampler2D compositionMask; uniform float compositionEnabled; uniform vec4 compositionBounds;
      vec4 compositionAt(vec2 world){
        vec2 uv=(world-compositionBounds.xy)/compositionBounds.zw;
        float inside=step(0.0,uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0);
        vec4 layer=texture2D(compositionMask,vec2(uv.x,1.0-uv.y));
        layer.a*=inside*compositionEnabled;
        return layer;
      }
      vec3 materialAt(vec2 uv,vec2 world){
        vec4 layer=compositionAt(world);
        return mix(texture2D(materialMask,clamp(uv,0.0,1.0)).rgb,layer.rgb,layer.a);
      }
      float patchHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float patchNoise(vec2 p){vec2 cell=floor(p),t=fract(p);t=t*t*(3.-2.*t);
        return mix(mix(patchHash(cell),patchHash(cell+vec2(1.,0.)),t.x),
          mix(patchHash(cell+vec2(0.,1.)),patchHash(cell+vec2(1.)),t.x),t.y);}
      vec3 paintedMeadow(vec2 world,vec2 uv){
        // Only unstructured vegetation can rotate. Stone joints keep their registered axes.
        // Constant affine UVs retain valid mip derivatives at every blend boundary.
        vec3 a=texture2D(meadow,uv).rgb;
        vec3 b=texture2D(meadow,vec2(-uv.y,uv.x)*1.13+vec2(.37,.71)).rgb;
        vec3 c=texture2D(meadow,vec2(uv.y,-uv.x)*.91+vec2(.83,.19)).rgb;
        float blend=patchNoise(world/meadowFinish.y+vec2(13.,41.));
        vec3 leaves=mix(mix(a,b,.35+.3*blend),c,.25);
        // Keep the source brush marks while compressing flowers and dark clumps into a calm midtone.
        return mix(meadowPaint,leaves,meadowFinish.x);
      }
      vec3 softenedStone(vec2 uv){
        vec2 softOffset=vec2(.012,0.);
        return (texture2D(stone,uv+softOffset).rgb
          +texture2D(stone,uv-softOffset).rgb
          +texture2D(stone,uv+softOffset.yx).rgb
          +texture2D(stone,uv-softOffset.yx).rgb)*.25;
      }
      void main(){
        // Image UV is flipped for top-down pixels. Spatial effects use actual plan coordinates.
        vec2 world = groundPlan;
        vec2 offset = world - groundBounds.xy;
        vec4 base = texture2D(groundBase, groundUv);
        vec3 mask = materialAt(groundUv,world);
        // Blue is street-center coverage only on the generated city plan; legacy masks retain their shade meaning.
        float roadCoverage=mask.b*streetPaving.x;
        float shade = 1.0 - mask.b*(1.-streetPaving.x);
        vec2 stoneDelta = world - stoneOrigin;
        vec2 stoneUv = vec2(dot(stoneDelta, stoneBasis.xy), dot(stoneDelta, stoneBasis.zw));
        // Blend material colors at the road edge; both registered UV scales stay affine.
        vec2 sidewalkUv=stoneUv/repeats.x;
        vec2 roadUv=sidewalkUv/streetPaving.y;
        vec3 paving = texture2D(stone, sidewalkUv).rgb;
        if(streetPaving.x>.5){
          paving=mix(paving,texture2D(stone,roadUv).rgb,roadCoverage);
        }
        float routeDistance=100000.;
        for(int i=0;i<15;i++){
          if(i+1<routeCount){
            vec2 a=routePoints[i],ab=routePoints[i+1]-a;
            float t=clamp(dot(world-a,ab)/max(dot(ab,ab),.0001),0.,1.);
            routeDistance=min(routeDistance,length(world-a-ab*t));
          }
        }
        float dialogueQuiet=(1.-smoothstep(routeFinish.x*.45,routeFinish.x,length(world-dialogueCenter)))*step(1.,float(routeCount));
        float routeQuiet=(1.-smoothstep(routeFinish.y*.35,routeFinish.y,routeDistance))*.55;
        float quiet=max(dialogueQuiet,routeQuiet);
        // Soften the two fixed scales before mixing so quiet routes keep the same joints.
        vec3 softStone=softenedStone(sidewalkUv);
        if(streetPaving.x>.5){
          softStone=mix(softStone,softenedStone(roadUv),roadCoverage);
        }
        paving=mix(paving,softStone,quiet*routeFinish.z);
        vec3 grass = paintedMeadow(world,offset / repeats.y) * shade;
        vec2 plazaOffset = world - plazaCenter;
        vec2 plazaUv = plazaOffset / (2.0 * plazaRadius) + .5;
        vec4 plazaColor = texture2D(plaza, clamp(plazaUv, 0.0, 1.0));
        float plazaCoverage = smoothstep(0.0, plazaFeather, plazaRadius - length(plazaOffset)) * plazaColor.a;
        paving = mix(paving, plazaColor.rgb, plazaCoverage);
        paving = mix(paving, pavingPaper, pavingPaperMix) * shade;
        // Low frequency plan-space color breaks repetition without drawing new pavement axes.
        float tonePatch=(patchNoise(world/artFinish.x)*.7+patchNoise(world/(artFinish.x*.43)+19.)*.3)*2.-1.;
        float weather=patchNoise(world/groundWeather.x+vec2(47.,13.));
        float stoneLuma=dot(paving,vec3(.2126,.7152,.0722));
        paving=mix(vec3(stoneLuma),paving,pavingSaturation);
        // Compress luminance as well as chroma across the whole plaza, including the fountain ring.
        // The old detailContrast changed saturation only, leaving high-contrast joints untouched.
        paving=mix(pavingPaper,paving,artFinish.z);
        paving=mix(paving,pavingPaper,artFinish.w)*(1.+tonePatch*artFinish.y);
        // Broad mineral variation breaks the repeat without offsetting or rotating stone joints.
        // Smaller soil deposits collect in the darker source joints; exposed stone tops stay clearer.
        float joint=1.-smoothstep(.32,.66,stoneLuma);
        float deposit=smoothstep(.42,.78,weather)*groundWeather.y;
        paving=mix(paving,groundSoil,deposit*(.35+joint*.65));
        paving=mix(paving,pavingPaper,quiet*routeFinish.w);
        paving*=mix(1.,streetPaving.z,roadCoverage*(1.-plazaCoverage));
        if(streetPaving.x>.5&&roadCoverage>.01){
          vec2 curbUv=streetPaving.w/groundBounds.zw*vec2(1.,-1.);
          float neighbor=min(min(texture2D(materialMask,groundUv+vec2(curbUv.x,0.)).b,
            texture2D(materialMask,groundUv-vec2(curbUv.x,0.)).b),
            min(texture2D(materialMask,groundUv+vec2(0.,curbUv.y)).b,
            texture2D(materialMask,groundUv-vec2(0.,curbUv.y)).b));
          float rim=roadCoverage*(1.-neighbor)*(1.-plazaCoverage);
          // A flush pale stone course defines the walking strip, without raised collision or extra geometry.
          paving=mix(paving,pavingPaper,rim*curbPaperMix);
        }
        grass*=1.+tonePatch*grassVariation;
        // Fixed plan-space edge width. Image V decreases as map Y increases.
        vec2 edgeUv = edgeFinish.x / groundBounds.zw * vec2(1.0, -1.0);
        vec3 edgeX1 = materialAt(groundUv + vec2(edgeUv.x,0.),world+vec2(edgeFinish.x,0.));
        vec3 edgeX2 = materialAt(groundUv - vec2(edgeUv.x,0.),world-vec2(edgeFinish.x,0.));
        vec3 edgeY1 = materialAt(groundUv + vec2(0.,edgeUv.y),world+vec2(0.,edgeFinish.x));
        vec3 edgeY2 = materialAt(groundUv - vec2(0.,edgeUv.y),world-vec2(0.,edgeFinish.x));
        float stoneEdge = mask.r * max(max(edgeX1.g,edgeX2.g),max(edgeY1.g,edgeY2.g));
        float grassEdge = mask.g * max(max(edgeX1.r,edgeX2.r),max(edgeY1.r,edgeY2.r));
        float edgeBreakup=.4+.6*patchNoise(world*1.3);
        paving *= 1.0 - stoneEdge * edgeFinish.y*edgeBreakup;
        // Sparse growth stains follow existing meadow boundaries; road coverage stays registered.
        float growth=smoothstep(.48,.83,patchNoise(world*.52));
        paving=mix(paving,grass,stoneEdge*growth*edgeGrowth);
        // Dry soil on the grass side makes a worn verge, while the registered mask stays fixed.
        grass=mix(grass,groundSoil,grassEdge*groundWeather.z*(.4+.6*growth));
        grass *= 1.0 + grassEdge * edgeFinish.z;
        vec3 color;
        if(streetPaving.x>.5){
          // R/G partition the land; base contributes only where their total coverage fades.
          float landCoverage=mask.r+mask.g;
          vec3 landColor=(paving*mask.r+grass*mask.g)/max(landCoverage,.0001);
          color=mix(base.rgb,landColor,clamp(landCoverage,0.,1.));
        }else{
          color=mix(base.rgb,paving,mask.r);
          color=mix(color,grass,mask.g*mix(.9,1.0,compositionAt(world).a));
        }
        // Evaluate depth per ground fragment, not at the four corners of the city plane.
        // Use the same linear-light distance profile as the buildings above this surface.
        color=cityAtmosphere(color,distanceColor,cityDistanceMix(world,distanceFocus,distanceViewDepth));
        gl_FragColor = vec4(color, base.a);
        #include <colorspace_fragment>
      }`})}var Go=`varying vec2 at;varying vec3 wp;void main(){at=uv;wp=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,Ko=class{world;meshes=[];centers;aprons=[];constructor(e,t,n,r){this.world=e;let i=t.filter(e=>ie(e.id)&&e.paintedVolume&&!M(e));this.centers=i.map(e=>e.anchor);for(let e of i){let t=ie(e.id),i=e.paintedVolume.vertices,a=i.slice(0,4),o=i[4][2],s=(e,t)=>{let n=[t[0]-e[0],t[1]-e[1]],r=Math.hypot(...n);return n.map(e=>e/r)},c=s(a[0],a[1]),u=s(a[1],a[2]),d=Math.hypot(a[1][0]-a[0][0],a[1][1]-a[0][1]),f=(e,t,n=.018)=>[a[0][0]+c[0]*e+u[0]*t,a[0][1]+c[1]*e+u[1]*t,n];for(let e of t.groundPatches){let t=d*e.along,r=e.width/2,i=-.1,a=i-e.depth;this.quad([f(t-r,a,.019),f(t+r,a,.019),f(t+r,i,.019),f(t-r,i,.019)],{image:{value:n.get(ae.groundPatchPath)},opacity:{value:e.opacity}},`uniform sampler2D image;uniform float opacity;varying vec2 at;void main(){vec4 c=texture2D(image,at);gl_FragColor=vec4(c.rgb,c.a*opacity);#include <colorspace_fragment>}`,5)}let p=E(e.id),m=t.life,h=p.map(e=>[e[0],e[1],0]),g=p.map(e=>[e[0],e[1],m.height]),_=[{points:[h[0],h[1],g[1],g[0]],path:m.frontPath},{points:[h[0],h[3],g[3],g[0]],path:m.sidePath},{points:[h[2],h[1],g[1],g[2]],path:m.sidePath},{points:[h[3],h[2],g[2],g[3]],path:m.sidePath},{points:g,path:m.topPath}],v=h.reduce((e,t)=>e.map((e,n)=>e+t[n]/4),[0,0,m.height/2]);for(let e of _)this.quad(e.points,{image:{value:n.get(e.path)},shade:{value:this.surfaceShade(e.points,v)}},`uniform sampler2D image;uniform float shade;varying vec2 at;void main(){vec4 c=texture2D(image,at);gl_FragColor=vec4(c.rgb*shade,c.a);#include <colorspace_fragment>}`,0,!0);this.polygonShadow(re([...h,...g]),ae.shadow.castOpacity,m.height),this.polygonShadow(p,.26);let y=d*t.matAlong,b=t.matWidth/2,x=-.12,S=x-t.matDepth,C=b*1.3,w=S-H.weathering.entranceReach;this.quad([f(y-C,w),f(y+C,w),f(y+C,x),f(y-C,x)],{paper:{value:new Y(l.villagePavingPaper)},opacity:{value:H.weathering.entranceOpacity}},`uniform vec3 paper;uniform float opacity;varying vec2 at;varying vec3 wp;
     void main(){float width=mix(.34,.50,at.y);float across=1.-smoothstep(width*.35,width,abs(at.x-.5));
      float along=smoothstep(0.,.38,at.y);float grain=.78+.22*sin(wp.x*1.7+sin(wp.y*1.3));
      gl_FragColor=vec4(paper,opacity*across*along*grain);#include <colorspace_fragment>}`,5),this.quad([f(y-b,S,.04),f(y+b,S,.04),f(y+b,x,.04),f(y-b,x,.04)],{image:{value:n.get(t.matPath)}},`uniform sampler2D image;varying vec2 at;void main(){gl_FragColor=texture2D(image,at);if(gl_FragColor.a<.02)discard;#include <colorspace_fragment>}`,7),this.aprons.push(this.quad([f(0,0),f(d,0),f(d,-ae.apronDepth),f(0,-ae.apronDepth)],{image:{value:r},size:{value:new X(d,ae.apronDepth)},warm:{value:new Y(t.lightColor)},strength:{value:t.lightStrength}},`uniform sampler2D image;uniform vec2 size;uniform vec3 warm;uniform float strength;varying vec2 at;
    void main(){vec2 p=at*size;vec3 c=texture2D(image,vec2(p.x/32.,p.y/32.)).rgb;
    c=mix(c,vec3(.68,.64,.55),.27);float rim=1.-smoothstep(.10,.21,min(min(p.x,size.x-p.x),size.y-p.y));
    c=mix(c,vec3(.46,.43,.36),rim*.32);float light=(exp(-pow((at.x-.24)*5.,2.))+exp(-pow((at.x-.77)*5.,2.)))*(1.-at.y);
    c=mix(c,warm,light*strength);gl_FragColor=vec4(c,.72);#include <colorspace_fragment>}`,3));let T=d*t.propAlong,D=-t.propDepth-.18,O=t.propHeight,k=t.propWidth/2,A=[f(T-k,D,0),f(T+k,D,0),f(T+k,D,O),f(T-k,D,O)],j=this.quad(A,{image:{value:n.get(t.propPath)},shade:{value:this.surfaceShade(A,f(T,D+t.propDepth/2,O/2))}},`uniform sampler2D image;uniform float shade;varying vec2 at;void main(){gl_FragColor=texture2D(image,at);if(gl_FragColor.a<.15)discard;gl_FragColor.rgb*=shade;#include <colorspace_fragment>}`,0,!0),M=D+t.propDepth,N=t.bodyHeight,ee=[[f(T-k,D,0),f(T-k,M,0),f(T-k,M,N),f(T-k,D,N)],[f(T+k,M,0),f(T+k,D,0),f(T+k,D,N),f(T+k,M,N)],[f(T-k,M,0),f(T+k,M,0),f(T+k,M,N),f(T-k,M,N)],[f(T-k,D,N),f(T+k,D,N),f(T+k,M,N),f(T-k,M,N)]],P=[t.bodySidePath,t.bodySidePath,t.bodyBackPath,t.bodyTopPath],te=f(T,D+t.propDepth/2,N/2);ee.forEach((e,t)=>this.quad(e,{image:{value:n.get(P[t])},shade:{value:this.surfaceShade(e,te)}},`uniform sampler2D image;uniform float shade;varying vec2 at;void main(){vec4 c=texture2D(image,at);if(c.a<.15)discard;gl_FragColor=vec4(c.rgb*shade,c.a);#include <colorspace_fragment>}`,0,!0)),this.polygonShadow(re([f(T-k,D,0),f(T+k,D,0),f(T+k,M,O),f(T-k,M,O)]),.23,O),this.polygonShadow([f(T-k,D),f(T+k,D),f(T+k,M),f(T-k,M)],.3),j.userData.shopId=e.id;let ne=d*.46,F=d*.56,oe=o*.67;this.quad([f(ne,-.02,0),f(ne+.18,-.02,0),f(ne+.18,-.02,oe),f(ne,-.02,oe)],{},`void main(){gl_FragColor=vec4(.13,.12,.10,.25);}`,0,!0),this.quad([f(ne,-.025,oe-.18),f(F,-.025,oe-.18),f(F,-.025,oe),f(ne,-.025,oe)],{},`void main(){gl_FragColor=vec4(.13,.12,.10,.22);}`,0,!0)}}near(e){return this.centers.some(t=>Math.hypot(e[0]-t[0],e[1]-t[1])<ae.contextRadius)}setUnifiedPaving(e){for(let t of this.aprons)t.visible=!e}quad(e,t,n,r=0,i=!1){let a=new _t;a.setAttribute(`position`,new Re(e.flatMap(e=>[e[0],e[1],e[2]]),3)),a.setAttribute(`uv`,new Re([0,0,1,0,1,1,0,1],2)),a.setIndex([0,1,2,0,2,3]);let o=new J({uniforms:t,vertexShader:Go,fragmentShader:n.replaceAll(`#include`,`
#include`),transparent:i,blending:i?1:5,blendSrc:204,blendDst:205,blendSrcAlpha:201,blendDstAlpha:205,depthTest:i,depthWrite:i,side:2}),s=new q(a,o);return a.computeBoundingSphere(),s.matrixAutoUpdate=!1,s.renderOrder=i?0:-(2**53-1)+r,this.meshes.push(s),this.world.add(s),s}surfaceShade(e,t){let n=e[0],r=e[1].map((e,t)=>e-n[t]),i=e[2].map((e,t)=>e-n[t]),a=[r[1]*i[2]-r[2]*i[1],r[2]*i[0]-r[0]*i[2],r[0]*i[1]-r[1]*i[0]],o=[0,1].map(t=>e.reduce((n,r)=>n+r[t]/e.length,0)),s=Math.abs(a[2])>1e-6?a[2]:a[0]*(o[0]-t[0])+a[1]*(o[1]-t[1]),c=Math.hypot(...a),l=s<0?-1:1;if(c===0)return d.lighting.ambient;let u=a.map(e=>e*l/c);return d.lighting.ambient+V(u,ae.shadow.direction,ae.shadow.slope)*d.lighting.sunStrength}polygonShadow(e,t,n=0){let r=Math.min(ae.shadow.castSoftnessMax,ae.shadow.contactSoftness+n*ae.shadow.slope*ae.shadow.castSoftnessHeightFactor),i=[0,1].map(t=>Math.min(...e.map(e=>e[t]))-r),a=[0,1].map(t=>Math.max(...e.map(e=>e[t]))+r),o=Array.from({length:16},()=>new K);e.slice(0,16).forEach((t,n)=>{let r=e[(n+1)%e.length];o[n].set(t[0],t[1],r[0],r[1])}),this.quad([[i[0],i[1],.027],[a[0],i[1],.027],[a[0],a[1],.027],[i[0],a[1],.027]],{edges:{value:o},count:{value:Math.min(16,e.length)},opacity:{value:t},softness:{value:r},ink:{value:new Y(l.villageShadowInk)}},`uniform vec4 edges[16];uniform float count;uniform float opacity;uniform float softness;uniform vec3 ink;varying vec3 wp;void main(){bool inside=false;float distance=1000.;vec2 p=wp.xy;
    for(int i=0;i<16;i++){if(float(i)>=count)break;vec2 a=edges[i].xy,b=edges[i].zw,d=b-a;float t=clamp(dot(p-a,d)/max(dot(d,d),.0001),0.,1.);distance=min(distance,length(p-a-t*d));
     if((a.y>p.y)!=(b.y>p.y)){if(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}}
    float alpha=opacity*(1.-smoothstep(-softness,softness,inside?-distance:distance));gl_FragColor=vec4(ink,alpha);#include <colorspace_fragment>}`,4)}updateDepth(e){for(let t of this.meshes)if(t.material.depthWrite){let n=t.geometry.getAttribute(`position`),r=0,i=0;for(let e=0;e<4;e++)r+=n.getX(e),i+=n.getY(e);t.renderOrder=-e([r/4,i/4])+3e-5}}dispose(){for(let e of this.meshes)this.world.remove(e),e.geometry.dispose(),e.material.dispose();this.meshes.length=0}};function qo(e,t,n,r){let i=D.fountain.segments,a=e.map(([e,r])=>[e*t,r*n]),o=Math.min(...a.map(e=>e[1])),s=Math.max(...a.map(e=>e[1])),c=[0];for(let e=1;e<a.length;e++)c.push(c[e-1]+Math.hypot(a[e][0]-a[e-1][0],a[e][1]-a[e-1][1]));let l={positions:[],uv:[],indices:[],normals:[]},u=e=>{let t=a[e],n=a[e+1],r=n[0]-t[0],i=n[1]-t[1],o=Math.hypot(r,i);return[i/o,-r/o]};for(let e=0;e<a.length;e++){let t=u(Math.max(0,e-1)),n=u(Math.min(a.length-2,e)),d=t[0]+n[0],f=t[1]+n[1],p=Math.hypot(d,f)||1,[m,h]=a[e],g=r?(h-o)/Math.max(1e-4,s-o):c[e]/c.at(-1);for(let t=0;t<=i;t++){let n=t/i*Math.PI*2,r=Math.cos(n),a=Math.sin(n);if(l.positions.push(r*m,a*m,h),l.normals.push(r*d/p,a*d/p,f/p),l.uv.push(t/i,g),e&&t){let n=e*(i+1)+t,r=n-i-1;l.indices.push(r-1,r,n,r-1,n,n-1)}}}return l}function Jo(e,t){let n=D.fountain,r={positions:[],uv:[],indices:[]};for(let i=0;i<n.spouts;i++){let a=i*Math.PI*2/n.spouts+n.spoutPhase,o=Math.cos(a),s=Math.sin(a),c=r.positions.length/3;for(let i=0;i<=n.fallSteps;i++){let a=i/n.fallSteps,l=e*(n.fallStart[0]+(n.fallEnd[0]-n.fallStart[0])*a),u=t*(n.fallStart[1]+n.fallLift*a+(n.fallEnd[1]-n.fallStart[1]-n.fallLift)*a*a),d=(n.fallNozzleWidth+(n.fallWidth-n.fallNozzleWidth)*Math.sqrt(a))*(.5-.12*a);for(let e of[-1,1])r.positions.push(o*l-s*d*e,s*l+o*d*e,u),r.uv.push((e+1)/2,1-a);if(i){let e=c+i*2,t=e-2;r.indices.push(t,t+1,e+1,t,e+1,e)}}}return r}function Yo(e,t){let n=D.fountain,r={positions:[],uv:[],indices:[],motion:[]};for(let i=0;i<n.spouts;i++)for(let a=0;a<n.splashDrops;a++){let o=i*Math.PI*2/n.spouts+n.spoutPhase,s=a*2.39996323+i,c=(a+.3*i)/n.splashDrops,l=n.splashSpread*(.5+.5*(a*7%5)/4),u=n.splashHeight*(.45+.55*(a*3%7)/6),d=Math.cos(o)*e*n.fallEnd[0],f=Math.sin(o)*e*n.fallEnd[0],p=t*n.fallEnd[1]+.02,m=n.splashSize*(1+a%3*.25),h=r.positions.length/3;for(let e=0;e<=n.splashRings;e++)for(let t=0;t<=n.splashSegments;t++){let i=e/n.splashRings*Math.PI,a=t/n.splashSegments*Math.PI*2;if(r.positions.push(d+Math.sin(i)*Math.cos(a)*m,f+Math.sin(i)*Math.sin(a)*m,p+Math.cos(i)*m*1.3),r.uv.push(.5,.5),r.motion.push(Math.cos(s)*l,Math.sin(s)*l,u,c),e&&t){let i=h+e*(n.splashSegments+1)+t,a=i-n.splashSegments-1;r.indices.push(a-1,a,i,a-1,i,i-1)}}}return r}function Xo(e,t){let{segments:n,waterRings:r}=D.fountain,i={positions:[],uv:[],indices:[],normals:[]};for(let a=0;a<=r;a++)for(let o=0;o<=n;o++){let s=o/n*Math.PI*2,c=e*a/r;if(i.positions.push(Math.cos(s)*c,Math.sin(s)*c,t),i.normals.push(0,0,1),i.uv.push(o/n,a/r),a&&o){let e=a*(n+1)+o,t=e-n-1;i.indices.push(t-1,e,t,t-1,e-1,e)}}return i}function Zo(e,t){e.computeBoundingSphere();let n=0;if(t===2&&(n=D.fountain.waveHeight),t===3&&(n=D.fountain.fallSway+D.fountain.fallWidthSway*.5),t===5){let t=e.getAttribute(`splashMotion`);for(let e=0;e<t.count;e++)n=Math.max(n,Math.hypot(t.getX(e),t.getY(e),t.getZ(e)))}e.boundingSphere.radius+=n}var Qo=()=>({positions:[],uv:[],indices:[]}),$o=Math.PI*2,es=class{world;textures;props=[];ids=new Set;time=0;constructor(e,t,n){this.world=e,this.textures=n;for(let e of t){let t=O(e);if(!t)continue;let n=t.kind===`fountain`?this.fountain(t.radius,t.height):t.kind===`lamp`?this.lamp(e.id,t.height):this.tree(e.id,t.radius,t.height,t.contactRadius);for(let t of n)t.position.set(...e.anchor,0),t.updateMatrix(),t.matrixAutoUpdate=!1,this.world.add(t);this.props.push({id:e.id,anchor:e.anchor,radius:t.radius??0,meshes:n,fade:1}),this.ids.add(e.id)}}has(e){return this.ids.has(e)}get count(){return this.props.length}update(e,t,n,r,i,a,o){let s=Math.max(0,Math.min(n,100));r||(this.time+=s/1e3);for(let n of this.props){let c=En(n.id,e)&&!(t&&n.id===`fountain`),l=-i(n.anchor),u=a(n.anchor),d=c&&o?.(n)?ce.alpha:1;n.fade=fe(n.fade,d,s,r);let f=n.fade<.999;for(let e of n.meshes)e.visible=c,e.renderOrder=l,e.material.uniforms.time.value=this.time,e.material.uniforms.distanceMix.value=u,e.material.uniforms.fade.value=n.fade,e.material.transparent!==f&&(e.material.transparent=f,e.material.depthWrite=!f)}}dispose(){for(let e of this.props)for(let t of e.meshes)this.world.remove(t),t.geometry.dispose(),t.material.dispose();this.props.length=0,this.ids.clear()}material(e,t,n,r,i,a=1){let[o,s,c,u]=t,f=new J({side:2,depthWrite:!0,transparent:!1,uniforms:{image:{value:this.textures.get(e)},rect:{value:new K(o/n[0],1-u/n[1],(c-o)/n[0],(u-s)/n[1])},repeats:{value:r},kind:{value:[`stone`,`leaves`,`water`,`fall`,`bark`,`spray`].indexOf(i)},shade:{value:a},saturation:{value:i===`leaves`?D.tree.foliageSaturation:H.fountain.saturation},sun:{value:new Z(...Te())},ambient:{value:i===`stone`?D.fountain.stoneAmbient:d.lighting.ambient},sunlight:{value:i===`stone`?D.fountain.stoneSunlight:d.lighting.sunStrength},foam:{value:new Y(l.villageWaterFoam)},time:{value:0},distanceMix:{value:0},fade:{value:1},mist:{value:new Y(l.cityDaySkyHorizon)},splash:{value:new Z(H.street.fountainRadius*D.fountain.fallEnd[0],D.fountain.spoutPhase,H.street.fountainHeight*.5)},stoneDetails:{value:new K(0,D.fountain.recessStrength,D.fountain.rimEdgeLight,0)},waterBounds:{value:new X},waterEdge:{value:D.fountain.waterEdgeShade},splashStrength:{value:D.fountain.splashStrength},flow:{value:new K(D.fountain.flowSpeed,D.fountain.flowStreaks,D.fountain.fallFoam,D.fountain.splashCycle)},waterMotion:{value:new K(D.fountain.waveHeight,D.fountain.waveFrequency,D.fountain.waveSpeed,D.fountain.fallSway)},leafPaint:{value:new Y(l.villageLeafMidtone)},leafShadow:{value:new Y(l.villageLeafShadow)},leafSun:{value:new Y(l.villageLeafSun)},leafLight:{value:new K(D.tree.lighting.detailContrast,D.tree.lighting.ambient,D.tree.lighting.sunlight,D.tree.lighting.lowerShade)},leafTint:{value:new X(D.tree.lighting.shadowTint,D.tree.lighting.keyTint)},treeHeight:{value:1}},vertexShader:`varying vec2 at;varying vec3 n;varying vec3 p;varying float life;varying float leafShade;
        attribute float crownShade;
        attribute vec4 splashMotion;uniform int kind;uniform float time;uniform vec4 flow;
        uniform vec4 waterMotion;uniform vec2 waterBounds;
        void main(){at=uv;n=normal;p=position;life=0.;leafShade=crownShade;
          if(kind==2){
            float r=length(p.xy),wet=smoothstep(waterBounds.y,waterBounds.y+.7,r)*(1.-smoothstep(waterBounds.x-.7,waterBounds.x,r));
            float amplitude=waterMotion.x*min(1.,waterBounds.x/6.)*wet;
            float a=p.x*waterMotion.y+p.y*.65+time*waterMotion.z;
            float b=p.y*waterMotion.y-p.x*.7-time*waterMotion.z*.8;
            p.z+=amplitude*(.65*sin(a)+.35*sin(b));
            n=normalize(vec3(-amplitude*(.65*waterMotion.y*cos(a)-.245*cos(b)),
              -amplitude*(.4225*cos(a)+.35*waterMotion.y*cos(b)),1.));
          }
          if(kind==3){
            vec2 tangent=normalize(vec2(-p.y,p.x));
            p.xy+=tangent*waterMotion.w*sin(at.y*22.+time*7.)*sin(at.y*3.14159265);
            p.xy+=tangent*(at.x-.5)*${D.fountain.fallWidthSway}*sin(at.y*35.+time*10.)*sin(at.y*3.14159265);
          }
          if(kind==5){life=fract(time/flow.w+splashMotion.w);p.xy+=splashMotion.xy*life;p.z+=splashMotion.z*4.*life*(1.-life);}
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,fragmentShader:`${Ae}
        uniform sampler2D image;uniform vec4 rect;uniform float repeats;uniform int kind;
        uniform float shade;uniform float saturation;uniform vec3 sun;uniform float ambient;uniform float sunlight;
        uniform vec3 foam;uniform float time;uniform float distanceMix;uniform float fade;uniform vec3 mist;
        uniform vec3 splash;
        uniform vec4 stoneDetails;uniform vec2 waterBounds;uniform float waterEdge;uniform float splashStrength;uniform vec4 flow;
        uniform vec3 leafPaint;uniform vec3 leafShadow;uniform vec3 leafSun;
        uniform vec4 leafLight;uniform vec2 leafTint;uniform float treeHeight;
        varying vec2 at;varying vec3 n;varying vec3 p;varying float life;varying float leafShade;
        void main(){
          vec2 q=vec2(repeats>1.?1.-abs(fract(at.x*repeats*.5)*2.-1.):at.x,at.y);
          if(kind==2)q=1.-abs(fract(p.xy*.045+vec2(sin(p.y*.8+time*1.4),cos(p.x*.9-time*1.2))*.018)*2.-1.);
          if(kind==3)q.y=fract(q.y+time*flow.x);
          vec4 c=texture2D(image,rect.xy+clamp(q,.002,.998)*rect.zw);
          if(c.a<.30)discard;
          float lit=ambient+sunlight*max(0.,dot(normalize(n),sun));
          if(kind==0)lit*=mix(.83,1.,smoothstep(-.5,.15,normalize(n).z));
          c.rgb=mix(vec3(dot(c.rgb,vec3(.2126,.7152,.0722))),c.rgb,saturation);
          if(kind==1){
            // The normal follows crown volume, not the flat card or viewing side.
            vec3 crownNormal=dot(n,n)>1e-8?normalize(n):vec3(0.,0.,1.);
            float light=smoothstep(-.25,.72,dot(crownNormal,sun));
            float lower=1.-smoothstep(.38,.76,p.z/treeHeight);
            c.rgb=mix(leafPaint,c.rgb,leafLight.x);
            c.rgb=mix(c.rgb,leafShadow,(1.-light)*leafTint.x);
            c.rgb=mix(c.rgb,leafSun,light*leafTint.y);
            lit=(leafLight.y+leafLight.z*light)*(1.-lower*leafLight.w)*leafShade;
          }
          c.rgb*=shade*lit;
          if(kind==0){
            float edge=exp(-min(at.y,1.-at.y)*85.);
            c.rgb*=1.-stoneDetails.y*exp(-at.y*22.);
            c.rgb*=1.+stoneDetails.z*edge*max(0.,n.z);
            if(stoneDetails.x>0.){
              float joint=fract(at.x*stoneDetails.x);float line=1.-smoothstep(.008,.025,min(joint,1.-joint));
              c.rgb*=1.-line*.23;
            }
          }
          if(kind==2){float waves=sin(p.x*2.8+time*1.5)*sin(p.y*3.1-time*.8);
            float radius=length(p.xy);float rim=exp(-max(0.,waterBounds.x-radius)*3.);
            float column=exp(-max(0.,radius-waterBounds.y)*4.);
            c.rgb*=1.-waterEdge*max(rim,column);
            float rings=0.;
            for(int i=0;i<4;i++){
              float a=float(i)*1.570796327+splash.y;
              float d=length(p.xy-vec2(cos(a),sin(a))*splash.x);
              float core=exp(-d*d*2.)*(.62+.18*sin(time*8.+float(i)));
              float ring=exp(-d*.55)*.48*smoothstep(.55,.95,sin(d*7.-time*5.));
              rings=max(rings,splashStrength*(core+ring));}
            float crest=.16*pow(max(0.,waves),3.);
            c.rgb=mix(c.rgb,foam,clamp(crest+(p.z<splash.z?rings:0.),0.,.92));}
          if(kind==3){
            float edge=.45+.035*sin(at.y*33.+time*2.);if(abs(at.x-.5)>edge)discard;
            float streak=pow(max(0.,sin(at.x*13.+(at.y+time*flow.x)*flow.y*6.2831853)),5.);
            float core=pow(max(0.,1.-abs(at.x-.5)*2.),2.);
            c.rgb=mix(c.rgb,foam,.20+flow.z*streak+.13*core);
          }
          if(kind==5){if(life<.04||life>.93)discard;c.rgb=mix(c.rgb,foam,.80);}
          gl_FragColor=vec4(cityAtmosphere(c.rgb,mist,distanceMix),fade);
          #include <colorspace_fragment>
        }`});if(!f.uniforms.image.value)throw Error(`Missing prop surface ${e}`);return f}mesh(e,t){let n=new _t;return n.setAttribute(`position`,new Re(e.positions,3)),n.setAttribute(`uv`,new Re(e.uv,2)),n.setIndex(e.indices),e.normals?n.setAttribute(`normal`,new Re(e.normals,3)):n.computeVertexNormals(),n.setAttribute(`splashMotion`,new Re(e.motion??new Float32Array(e.positions.length/3*4),4)),n.setAttribute(`crownShade`,new Re(e.crownShade??new Float32Array(e.positions.length/3).fill(1),1)),Zo(n,t.uniforms.kind.value),new q(n,t)}fountain(e,t){let n=D.fountain,r=ne.fountain,i=[];for(let[a,o,s,c,l]of[[`base`,n.baseProfile,null,24,n.stoneJoints[0]],[`basin`,n.basinProfile,n.stonePixels,18,0],[`basin-rim`,n.basinRimProfile,null,24,n.stoneJoints[1]],[`column-base`,n.columnBaseProfile,null,8,0],[`column-flower`,n.columnFlowerProfile,n.columnFlowerPixels,8,0],[`column`,n.columnProfile,n.columnPixels,8,0],[`column-collar`,n.columnCollarProfile,null,8,0],[`upper-base`,n.upperBaseProfile,null,12,0],[`upper`,n.upperProfile,n.upperPixels,12,0],[`upper-rim`,n.upperRimProfile,null,12,n.stoneJoints[2]],[`finial`,n.finialProfile,null,6,0]]){let u=qo(o,e,t,s!==null),d=s===null,f=this.material(d?n.stonePath:r.sourcePath,s??[0,0,512,512],d?[512,512]:r.imageSize,c,`stone`,H.fountain.stoneShade);f.uniforms.stoneDetails.value.x=l;let p=this.mesh(u,f);p.name=`fountain-`+a,i.push(p)}for(let[r,[a,o]]of n.waterLevels.entries()){let s=Xo(a*e,o*t),c=this.material(n.waterPath,[0,0,512,512],[512,512],1,`water`,H.fountain.waterShade);c.uniforms.waterBounds.value.set(a*e,e*(r===0?.205:.1));let l=this.mesh(s,c);l.name=`fountain-water-`+r,i.push(l)}let a=this.mesh(Jo(e,t),this.material(n.waterPath,[0,0,512,512],[512,512],1,`fall`));a.name=`fountain-falls`,i.push(a);let o=this.mesh(Yo(e,t),this.material(n.waterPath,[0,0,512,512],[512,512],1,`spray`));return o.name=`fountain-spray`,i.push(o),i}tree(e,t,n,r){let i=D.tree,a=Qo(),o={...Qo(),crownShade:[]},s=A(e),c=s.phase,l=e=>[s.lean[0]*t*e,s.lean[1]*t*e,e*n];ns(a,i.trunkProfile.map(([e,r])=>[e*t,r*n]),12);for(let e=0;e<a.positions.length;e+=3){let r=a.positions[e+2]/n;a.positions[e]+=s.lean[0]*t*r,a.positions[e+1]+=s.lean[1]*t*r}for(let e=0;e<i.roots;e++){let n=c+e*$o/i.roots;rs(a,l(.13),[Math.cos(n)*r,Math.sin(n)*r,.06],t*.065,.045,6)}for(let e of s.clusters){let r=[e.center[0]*t,e.center[1]*t,e.center[2]*n];rs(a,l(e.center[2]-.22),r,t*.032,t*.008,6);for(let a=0;a<i.clusterPlanes;a++){let s=e.yaw+a*Math.PI/i.clusterPlanes,c=[Math.cos(s)*t*e.halfWidth,Math.sin(s)*t*e.halfWidth,0],l=[-Math.sin(s)*n*e.relativeHeight*e.tilt,Math.cos(s)*n*e.relativeHeight*e.tilt,n*e.relativeHeight*.5];if(ts(o,[-1,1].flatMap(e=>[-1,1].map(t=>r.map((n,r)=>n+c[r]*t+l[r]*e)))),o.crownShade.push(...[,,,,].fill(e.shade)),e.flip)for(let e=o.uv.length-8;e<o.uv.length;e+=2)o.uv[e]=1-o.uv[e]}}let u=this.material(i.foliagePath,[0,0,640,640],[640,640],1,`leaves`,s.shade);u.uniforms.saturation.value=s.saturation,u.uniforms.treeHeight.value=n,o.normals=[];for(let e=0;e<o.positions.length;e+=3)o.normals.push(...k([o.positions[e],o.positions[e+1],o.positions[e+2]],t,n));let d=[this.mesh(a,this.material(i.sourcePath,i.barkPixels,i.sourceImageSize,4,`bark`)),this.mesh(o,u)];return d[0].name=e+`-trunk`,d[1].name=e+`-`+s.form,d}lamp(e,t){return Object.entries(ee(t)).map(([t,n])=>{let r=this.material(N.sourcePath,[0,0,...N.imageSize],N.imageSize,1,`bark`,N.shade);r.uniforms.ambient.value=t===`glass`?N.glassAmbient:N.ambient,r.uniforms.sunlight.value=N.sunlight,r.uniforms.saturation.value=1;let i=this.mesh(n,r);return i.name=e+`-`+t,i})}};function ts(e,t){let n=e.positions.length/3;for(let n of t)e.positions.push(...n);e.uv.push(0,0,1,0,0,1,1,1),e.indices.push(n,n+1,n+3,n,n+3,n+2)}function ns(e,t,n){let r=e.positions.length/3;for(let i=0;i<t.length;i++)for(let a=0;a<=n;a++){let o=$o*a/n,[s,c]=t[i];if(e.positions.push(Math.cos(o)*s,Math.sin(o)*s,c),e.uv.push(a/n,i/(t.length-1)),i&&a){let t=r+i*(n+1)+a,o=t-(n+1);e.indices.push(o-1,o,t,o-1,t,t-1)}}}function rs(e,t,n,r,i,a){let o=new Z(...n).sub(new Z(...t)).normalize(),s=new Z(0,0,1);Math.abs(o.z)>.95&&s.set(1,0,0),s.cross(o).normalize();let c=o.clone().cross(s).normalize(),l=e.positions.length/3;for(let o=0;o<2;o++)for(let u=0;u<=a;u++){let d=$o*u/a,f=o?i:r,p=o?n:t,m=s.clone().multiplyScalar(Math.cos(d)*f).addScaledVector(c,Math.sin(d)*f);if(e.positions.push(p[0]+m.x,p[1]+m.y,p[2]+m.z),e.uv.push(u/a,o),o&&u){let t=l+a+1+u,n=l+u;e.indices.push(n-1,n,t,n-1,t,t-1)}}}function is(e,t,n){let r=n.get(pe.path);if(!r)throw Error(`Missing cathedral baked lightmap`);let i=new Map;for(let e of t.faces){let r=e.surface;if(!r||!e.normal)throw Error(`Missing painterly registration: ${e.id}`);let a=pe.uvByFace[e.id];if(!a||a.length!==r.indices.length*2)throw Error(`Stale cathedral lightmap UVs: ${e.id}`);let o=i.get(e.path);o||(o={positions:[],uv:[],normals:[],lightUv:[],indices:[],ink:[]},i.set(e.path,o));let s=o.positions.length/3;for(let t of r.indices)o.positions.push(...r.positions.slice(t*3,t*3+3)),o.uv.push(...r.uv.slice(t*2,t*2+2)),o.normals.push(...e.normal);if(o.lightUv.push(...a),o.indices.push(...r.indices.map((e,t)=>t+s)),e.ink){let n=[...new Set(e.vertices)];for(let r=0;r<n.length;r++)for(let i of[n[r],n[(r+1)%n.length]]){let n=t.vertices[i];o.ink.push(...n.map((t,n)=>t+e.normal[n]*.025))}}if(e.repeatTexture){let t=n.get(e.path);t.wrapS=t.wrapT=mt,t.needsUpdate=!0}}let a=new Z(...Te()),o=t.faces.find(e=>e.id===`nave-front-0`)?.normal;if(!o)throw Error(`Painterly cathedral requires its registered front normal`);let s=H.cathedralPainterly.lightmap,c={lightingMap:{value:r},facadeShadowStrength:{value:s.strength},facadeShadowTint:{value:new Y(l.cityCathedralCastTint)},indirectFill:{value:s.indirectFill}};return[...i].map(([t,r],i)=>{let s=new _t;for(let[e,t,n]of[[`position`,r.positions,3],[`uv`,r.uv,2],[`normal`,r.normals,3],[`lightUv`,r.lightUv,2]])s.setAttribute(e,new Re(t,n));s.setIndex(r.indices),s.computeBoundingSphere();let u=H.cathedralPainterly,d={nprDebug:{value:0},image:{value:n.get(t)},sun:{value:a},distanceMix:{value:0},distanceColor:{value:new Y(l.cityDaySkyHorizon)},stoneBalance:{value:new Y(l.cityCathedralStoneBalance)},stoneFillColor:{value:new Y(l.cityCathedralStoneFill)},frontNormal:{value:new Z(...o)},stoneFill:{value:u.stoneFill},frontStoneFill:{value:u.frontStoneFill},gold:{value:+!!t.endsWith(`/gold.webp`)},...c,roof:{value:+!!t.endsWith(`/slate.webp`)},roofExposure:{value:u.roofExposure},roofChroma:{value:u.roofChroma},occlusion:{value:u.occlusion}},f=new J({side:2,uniforms:d,vertexShader:`attribute vec2 lightUv;varying vec2 at,lightAt;varying vec3 worldNormal;
    void main(){at=uv;lightAt=lightUv;worldNormal=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform sampler2D image;uniform vec3 sun,distanceColor,stoneBalance,stoneFillColor,frontNormal;
    uniform float distanceMix,roof,roofExposure,roofChroma,occlusion,stoneFill,frontStoneFill,gold;varying vec2 at,lightAt;varying vec3 worldNormal;
    uniform sampler2D lightingMap;uniform vec3 facadeShadowTint;uniform float facadeShadowStrength,indirectFill;
    ${je}
    ${Ee}
    ${Ae}
    void main(){
     vec4 sampleColor=texture2D(image,at);if(sampleColor.a<.15)discard;
     vec3 c=sampleColor.rgb;float luma=dot(c,vec3(.2126,.7152,.0722));
     float facing=max(0.,dot(normalize(worldNormal),sun));
     vec3 lighting=texture2D(lightingMap,lightAt).rgb;
     if(roof>.5)c=mix(vec3(luma),c,roofChroma)*roofExposure;
     else c*=mix(vec3(1.),stoneBalance,smoothstep(.06,.40,luma));
     float ao=mix(1.-occlusion,1.,lighting.g);
     c=cityNprLighting(c,worldNormal,facing,1.,ao,roof>.5?2.:1.);
     // Painted warm stone receives a broad facade bounce. Dark wood, teal glass, gold and slate retain their colors.
     // The registered front normal follows building placement, never the camera.
     if(roof<.5&&gold<.5&&nprDebug<.5){
      float stone=smoothstep(.18,.55,luma)*smoothstep(.015,.08,sampleColor.r-sampleColor.b);
      float frontWeight=smoothstep(.35,.95,dot(normalize(worldNormal),normalize(frontNormal)));
      float fill=stone*(stoneFill+frontStoneFill*frontWeight)*mix(.65,1.,ao);
      c=mix(c,max(c,stoneFillColor),fill);
      c=mix(c,max(c,stoneFillColor),stone*indirectFill*lighting.b*(1.-lighting.g));
     }
     // R is shadowed / unoccluded Cycles direct light: tilted but unoccluded roofs stay unshadowed.
     float castAmount=1.-lighting.r;
     if(nprDebug<.5)c*=mix(vec3(1.),facadeShadowTint,facadeShadowStrength*castAmount*smoothstep(.06,.30,luma));
     if(nprDebug>3.5)c=vec3(castAmount);
     gl_FragColor=vec4(nprDebug<.5?cityAtmosphere(c,distanceColor,distanceMix):c,1.);
     #include <colorspace_fragment>
    }`}),p=new q(s,f);if(p.matrixAutoUpdate=!1,e.add(p),r.ink.length){let e=new _t;e.setAttribute(`position`,new Re(r.ink,3));let t=new J({transparent:!0,depthWrite:!1,uniforms:{...d,ink:{value:new Y(l.cityCathedralInk)},opacity:{value:u.inkOpacity}},vertexShader:`void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform vec3 ink,distanceColor;uniform float distanceMix,opacity;${Ae}
     void main(){gl_FragColor=vec4(cityAtmosphere(ink,distanceColor,distanceMix),opacity);#include <colorspace_fragment>}`.replace(`;#include`,`;
#include`)}),n=new nt(e,t);n.frustumCulled=!1,p.add(n),s.addEventListener(`dispose`,()=>{e.dispose(),t.dispose()})}return{id:`painterly-batch-${i}`,normal:[0,0,1],twoSided:!0,mesh:p}})}function as(e,t){return t||e.startsWith(`native-city-npc-`)||e===`native-city-vending`||e.startsWith(`native-city-life-`)&&!e.startsWith(`native-city-life-speech-`)||/^native-city-delivery-(courier|merchant|neighbor)$/.test(e)||e===`otto-porter`||e===`otto-waiting-carrier`}var os=class{world;shadows=new Map;constructor(e){this.world=e}beginFrame(){for(let e of this.shadows.values())e.visible=!1}update(e,t,n,r,i){if(n<=0||r<=.01)return;let a=this.shadows.get(e),s=H.actor;if(!a){let t=new J({transparent:!1,blending:5,blendSrc:204,blendDst:205,blendSrcAlpha:201,blendDstAlpha:205,depthTest:!1,depthWrite:!1,side:2,uniforms:{ink:{value:new Y(l.villageShadowInk)},opacity:{value:r},reach:{value:0},radius:{value:0},size:{value:new X},castOpacity:{value:s.castOpacity},contactOpacity:{value:s.contactOpacity},contactCount:{value:0},contacts:{value:Array.from({length:4},()=>new K)}},vertexShader:`varying vec2 at;void main(){at=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform vec3 ink;uniform float opacity,reach,radius,castOpacity,contactOpacity;
          uniform vec2 size;uniform int contactCount;uniform vec4 contacts[4];varying vec2 at;
          void main(){
            if(contactCount>0){
              float contact=0.;vec2 uv=vec2(at.x,1.-at.y);
              for(int i=0;i<4;i++){
                if(i>=contactCount)break;
                contact=max(contact,1.-smoothstep(.25,1.,length((uv-contacts[i].xy)/contacts[i].zw)));
              }
              gl_FragColor=vec4(ink,contact*contactOpacity*opacity);
            }else{
            vec2 p=(at-.5)*size; p.x+=reach*.5;
            float castShade=1.-smoothstep(.48,1.,length(vec2((p.x-reach*.46)/(reach*.60+radius),p.y/radius)));
            float contact=1.-smoothstep(.12,1.,length(p/vec2(radius*.7,radius*.82)));
            float shade=1.-(1.-castShade*castOpacity)*(1.-contact*contactOpacity);
            gl_FragColor=vec4(ink,shade*opacity);
            }
            #include <colorspace_fragment>
          }`});a=new q(new vt(1,1),t),a.frustumCulled=!1,a.renderOrder=o.actorShadow,this.shadows.set(e,a),this.world.add(a)}let c=a.material.uniforms;if(c.contactCount.value=Math.min(4,i?.contacts.length??0),i?.contacts.length){let[e,t,n]=i.corners;a.matrixAutoUpdate=!1,a.matrix.set(t[0]-e[0],e[0]-n[0],0,(t[0]+n[0])/2,t[1]-e[1],e[1]-n[1],0,(t[1]+n[1])/2,0,0,1,.035,0,0,0,1),a.matrixWorldNeedsUpdate=!0,i.contacts.slice(0,4).forEach((e,t)=>c.contacts.value[t].set(e.x,e.y,e.rx,e.ry)),c.opacity.value=r,a.visible=!0;return}a.matrixAutoUpdate=!0;let[u,f]=we(),p=n*s.heightRatio*d.sun.slope,m=n*s.radiusRatio,h=p*1.3+m*2,g=m*2;a.position.set(t[0]+u*p*.5,t[1]+f*p*.5,.035),a.rotation.z=Math.atan2(f,u),a.scale.set(h,g,1),a.material.uniforms.size.value.set(h,g),a.material.uniforms.reach.value=p,a.material.uniforms.radius.value=m,a.material.uniforms.opacity.value=r,a.visible=!0}endFrame(){for(let[e,t]of this.shadows)t.visible||(this.world.remove(t),t.geometry.dispose(),t.material.dispose(),this.shadows.delete(e))}get visibleCount(){return[...this.shadows.values()].filter(e=>e.visible).length}dispose(){this.beginFrame(),this.endFrame()}},ss=class{world;meshes=[];marked=[];textures=new Map;used=0;usedMarks=0;order=0;constructor(e){this.world=e}update(e){this.used=0,this.usedMarks=0,this.order=0;for(let t of e){if(t.mark){t.edgeAlpha>0&&this.drawMark(t,t.mark);continue}t.fillAlpha>0&&this.draw(t.concave?cs(t.points):R(t.points),t.fill,t.fillAlpha),t.edgeAlpha>0&&this.draw(L(t.points,t.edgeWidth),t.edge,t.edgeAlpha)}for(let e=this.used;e<this.meshes.length;e++)this.meshes[e].visible=!1;for(let e=this.usedMarks;e<this.marked.length;e++)this.marked[e].visible=!1}get visibleCount(){return this.used+this.usedMarks}dispose(){for(let e of[...this.meshes,...this.marked])this.world.remove(e),e.geometry.dispose(),e.material.dispose();for(let e of this.textures.values())e.dispose();this.meshes.length=0,this.marked.length=0,this.textures.clear()}drawMark(e,t){let{positions:n,uvs:r}=ge(e.points,e.edgeWidth,t);if(n.length===0)return;let i=this.textures.get(t.key);i||(i=new Gt(t.image),i.colorSpace=wt,i.needsUpdate=!0,this.textures.set(t.key,i));let a=this.marked[this.usedMarks];a||(a=new q(new _t,ls()),a.frustumCulled=!1,this.marked.push(a),this.world.add(a)),us(a.geometry,`position`,n,3),us(a.geometry,`uv`,r,2),a.material.map!==i&&(a.material.map=i,a.material.needsUpdate=!0),this.show(a,e.edge,e.edgeAlpha),this.usedMarks++}draw(e,t,n){if(e.length===0)return;let r=this.meshes[this.used];r||(r=new q(new _t,ls()),r.frustumCulled=!1,this.meshes.push(r),this.world.add(r)),us(r.geometry,`position`,e,3),this.show(r,t,n),this.used++}show(e,t,n){e.material.color.setHex(t),e.material.opacity=n,e.renderOrder=o.decal+this.order++,e.position.z=.03,e.visible=!0}};function cs(e){let t=[];if(e.length<3)return t;let n=e.map(([e,t])=>new X(e,t));for(let[e,r,i]of Nt.triangulateShape(n,[]))for(let a of[e,r,i])t.push(n[a].x,n[a].y,0);return t}function ls(){return new We({transparent:!1,blending:5,blendSrc:204,blendDst:205,blendSrcAlpha:201,blendDstAlpha:205,depthTest:!1,depthWrite:!1,side:2})}function us(e,t,n,r){let i=e.getAttribute(t);i&&i.array.length===n.length?(i.array.set(n),i.needsUpdate=!0):e.setAttribute(t,new Re(n,r))}var ds=Object.freeze([{folder:`art/characters/first-outfit/native-city-lupin-approved-ortho16-20261006/`,scale:.5}]);function fs(e){return ds.find(t=>e.startsWith(t.folder))?.scale??1}var ps=e=>new Y(e),ms=`uniform float uDepth;varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position.z=uDepth*gl_Position.w;}`,hs=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;function gs(e,t){return new J({transparent:!1,blending:5,blendSrc:204,blendDst:205,blendSrcAlpha:201,blendDstAlpha:205,depthTest:!1,depthWrite:!1,side:2,uniforms:t,vertexShader:hs,fragmentShader:e})}function _s(e,t,n=!1){return new J({transparent:!0,depthWrite:!1,side:2,blending:n?2:1,uniforms:{uDepth:{value:0},...t},vertexShader:ms,fragmentShader:e})}var vs=`uniform vec3 uInk;uniform float uAlpha;varying vec2 vUv;
void main(){float r=length((vUv-.5)*2.);gl_FragColor=vec4(uInk,(1.-smoothstep(.35,1.,r))*uAlpha);}`,ys=`uniform vec3 uInk;uniform vec3 uLight;uniform float uAlpha;uniform float uSeed;varying vec2 vUv;
float hash(float n){return fract(sin(n*91.7+uSeed)*43758.5);}
void main(){
  vec2 p=(vUv-.5)*2.;float r=length(p),a=atan(p.y,p.x);
  float ink=0.,lit=0.;
  for(int k=0;k<7;k++){
    float fk=float(k),base=fk*.898+hash(fk)*.45;
    float wob=.07*sin(r*21.+fk*3.)+.04*sin(r*47.+fk);
    float d=abs(mod(a-base-wob+3.14159,6.28318)-3.14159)*r;
    float reach=.62+.33*hash(fk+9.);
    float along=smoothstep(.36,.4,r)*(1.-smoothstep(reach-.06,reach,r));
    float w=mix(.014,.003,clamp((r-.38)/.6,0.,1.));
    ink=max(ink,(1.-smoothstep(w,w+.006,d))*along);
    lit=max(lit,(1.-smoothstep(w+.004,w+.012,abs(d-w-.008)))*along*.35);
  }
  float ring=abs(r-.46);float gaps=step(.5,fract(a*1.6+uSeed));
  ink=max(ink,(1.-smoothstep(.004,.009,ring))*gaps);
  float alpha=max(ink,lit*.5)*uAlpha;
  gl_FragColor=vec4(mix(uLight,uInk,ink>lit*.5?1.:0.),alpha);
}`,bs=`uniform vec3 uEdge;uniform vec3 uGlow;uniform float uRadius;uniform float uEcho;uniform float uLife;uniform float uW;
uniform float uSeed;varying vec2 vUv;
void main(){
  vec2 p=(vUv-.5)*2.;float r=length(p),a=atan(p.y,p.x);
  float wob=(.008*sin(a*5.+uSeed)+.005*sin(a*11.-uSeed))*(.5+uRadius);
  float s=r-uRadius-wob;
  float hw=mix(.035,.0175,uLife)*uW*.5;
  float edge=1.-smoothstep(hw,hw+.004,abs(s));
  float trail=clamp(1.+s/(.10*uW),0.,1.)*step(s,0.);
  float echoS=abs(r-uEcho-wob);
  float echo=(1.-smoothstep(.003,.007,echoS))*step(.02,uEcho)*.3;
  float breaks=smoothstep(mix(-1.05,-.5,uLife),mix(-.85,-.3,uLife),sin(a*6.+uSeed+r*1.5));
  float fade=smoothstep(0.,.05,uLife)*pow(1.-uLife,1.3);
  float glow=trail*.55;
  float alpha=max(edge*.5,max(glow,echo))*breaks*fade;
  vec3 col=edge*.5>=max(glow,echo)?uEdge:uGlow;
  gl_FragColor=vec4(col,alpha);
}`,xs=`uniform vec3 uColor;uniform vec3 uShade;uniform float uAlpha;uniform float uSeed;varying vec2 vUv;
void main(){
  vec2 p=(vUv-.5)*2.;float a=atan(p.y,p.x);
  float edge=.8+.12*sin(a*3.+uSeed)+.05*sin(a*5.-uSeed*2.);
  float r=length(p)/edge;
  float alpha=(1.-smoothstep(.3,1.,r))*uAlpha;
  gl_FragColor=vec4(mix(uShade,uColor,smoothstep(.1,.7,vUv.y)),alpha);
}`,Ss=`uniform vec3 uColor;uniform vec3 uLight;uniform vec3 uInk;uniform float uAlpha;uniform float uSeed;varying vec2 vUv;
void main(){
  vec2 p=(vUv-.5)*2.;float a=atan(p.y,p.x);
  float edge=.72+.16*sin(a*3.+uSeed)+.08*sin(a*5.-uSeed);
  float r=length(p)/edge;
  if(r>1.)discard;
  vec3 c=mix(uColor,uLight,smoothstep(-.2,.6,p.y));
  c=mix(c,uInk,smoothstep(.8,.95,r));
  gl_FragColor=vec4(c,uAlpha);
}`,Cs=`uniform vec3 uGlow;uniform vec3 uCore;uniform float uAlpha;uniform float uTime;uniform float uHead;varying vec2 vUv;
void main(){
  float x=abs(vUv.x-.5)*2.;
  float core=exp(-x*x*22.),glow=exp(-x*x*4.);
  float streak=.75+.25*sin(vUv.y*40.+uTime*.018+sin(vUv.x*20.)*2.);
  float fade=mix(smoothstep(0.,.08,vUv.y),1.,uHead)*(.55+.45*vUv.y);
  float head=uHead*exp(-vUv.y*14.)*exp(-x*x*6.)*1.6;
  vec3 c=mix(uGlow,uCore,min(1.,core+head));
  gl_FragColor=vec4(c*(glow*.45+core+head)*streak*fade*uAlpha,1.);
}`,ws=`uniform vec3 uCore;uniform vec3 uGlow;uniform float uLife;varying vec2 vUv;
void main(){
  vec2 p=(vUv-.5)*2.;float r=length(p);
  float radius=.2+.8*(1.-pow(1.-uLife,3.));
  float ring=(1.-smoothstep(.015,.04,abs(r-radius)))*(1.-uLife);
  float core=(1.-smoothstep(0.,.35,r))*max(0.,1.-uLife*3.);
  gl_FragColor=vec4(mix(uGlow,uCore,core),max(ring*.8,core*.7));
}`,Ts=`uniform vec3 uCore;uniform float uAlpha;varying vec2 vUv;
void main(){
  float x=vUv.x,lines=0.;
  for(int k=0;k<6;k++){float fk=float(k);float cx=.08+fk*.168+.03*sin(fk*4.1);
    float len=.55+.45*fract(sin(fk*12.9)*43.7);
    lines=max(lines,(1.-smoothstep(.006,.016,abs(x-cx)))*(1.-smoothstep(len*.6,len,vUv.y)));}
  gl_FragColor=vec4(uCore,lines*uAlpha*(1.-vUv.y*.6));
}`,Es=`uniform vec3 uGlow;uniform vec3 uCore;uniform vec3 uInk;uniform float uOpen;uniform float uTime;uniform float uSeed;varying vec2 vUv;
float jag(float x){return .6+.2*sin(x*6.+uSeed)+.1*sin(x*13.-uSeed*2.)+.04*sin(x*29.);}
void main(){
  vec2 p=(vUv-.5)*vec2(2.,2.);
  float lens=pow(max(0.,1.-p.x*p.x),.7)*jag(p.x)*uOpen;
  float y=abs(p.y);
  float inside=1.-smoothstep(lens-.02,lens,y);
  float rim=(1.-smoothstep(lens+.015,lens+.045,y))*(1.-inside)*step(.01,uOpen);
  float cracks=0.;
  for(int k=0;k<4;k++){float fk=float(k);float cx=-.68+fk*.45+.08*sin(fk*7.+uSeed);
    float len=(.12+.08*sin(fk*3.1+uSeed))*uOpen;
    float d=abs(p.x-cx-.25*(y-lens)*sign(cx));
    cracks=max(cracks,(1.-smoothstep(.006,.014,d))*step(lens,y)*(1.-smoothstep(lens+len-.04,lens+len,y)));}
  float swirl=.5+.5*sin(p.x*9.+uTime*.01+p.y*14.);
  vec3 c=mix(uGlow,uCore,smoothstep(.0,.45,1.-y/max(lens,.001))*(.7+.3*swirl));
  float glow=exp(-max(0.,y-lens)*4.)*.3*uOpen;
  vec3 col=inside>0.?c:mix(uGlow,uInk,max(rim,cracks));
  float alpha=max(max(inside,rim),max(cracks*.6,glow));
  gl_FragColor=vec4(col,alpha);
}`,Ds=e=>{let t=Math.sin(e*127.1+311.7)*43758.5453;return t-Math.floor(t)},Os=class{world;shadow=null;crack=null;ring=null;pillar=null;rift=null;strike=null;streak=null;dust=[];debris=[];splash=[];timeMs=0;constructor(e){this.world=e}get visibleCount(){return[this.shadow,this.crack,this.ring,this.pillar,this.rift,this.strike,this.streak,...[...this.dust,...this.debris,...this.splash].map(e=>e.mesh)].filter(e=>e?.visible).length}update(e,t,n){if(this.hideAll(),e===null)return;this.timeMs+=Math.max(0,Math.min(100,n));let r=e.widthWorldPx/t.scale,i=e.widthWorldPx/t.vertical,[a,s]=e.point,c=e.timing.impact,u=Math.sqrt(Math.max(0,1-(t.vertical/t.scale)**2)),d=e.timing.drop.fountainFrontPx/Math.max(1e-6,t.scale*u),f=[a-t.right.y*d,s+t.right.x*d];if(e.shadow>0){let t=this.shadow??=this.ground(vs,{uInk:{value:ps(l.villageShadowInk)},uAlpha:{value:0}},o.actorShadow+1),n=r*(.32+.42*e.shadow);t.position.set(a,s,.036),t.scale.set(n*2,n*1.5,1),t.material.uniforms.uAlpha.value=.18+.3*e.shadow,t.visible=!0}if(e.crack>0){let t=this.crack??=this.ground(ys,{uInk:{value:ps(l.otherworldCrackInk)},uLight:{value:ps(l.otherworldDebrisLight)},uAlpha:{value:0},uSeed:{value:3.7}},o.decal-1),n=r*1.45;t.position.set(a,s,.037),t.scale.set(n*2,n*2,1),t.material.uniforms.uAlpha.value=e.crack,t.visible=!0}let p=e.impactAgeMs;if(p!==null&&p<c.ringMs){let t=c.ringRadiusInWidths*r*1.08,n=this.ring??=this.ground(bs,{uEdge:{value:ps(l.otherworldCrackInk)},uGlow:{value:ps(l.otherworldRiftCore)},uRadius:{value:0},uEcho:{value:0},uLife:{value:0},uW:{value:0},uSeed:{value:1.3}},o.decal-2);n.position.set(a,s,.038),n.scale.set(t*2,t*2,1);let i=n.material.uniforms,u=r/t;i.uRadius.value=ye(p,e.timing)*u,i.uEcho.value=p>c.echoDelayMs?ye(p-c.echoDelayMs,e.timing)*.8*u:0,i.uLife.value=p/c.ringMs,i.uW.value=u,n.visible=!0}if(p!==null&&(this.puffs(e,t,r,i,p),this.chips(e,t,r,i,p),this.drops(e,t,r,i,p)),e.pillar>.01&&e.pillarReach>0){let n=e.timing.rift.heightInWidths*i,o=n*(1-e.pillarReach),c=this.pillar??=this.billboard(Cs,{uGlow:{value:ps(l.otherworldRift)},uCore:{value:ps(l.otherworldRiftCore)},uAlpha:{value:0},uTime:{value:0},uHead:{value:0}},!0);c.material.uniforms.uDepth.value=t.depthOf(f)+2e-5,c.material.uniforms.uAlpha.value=e.pillar,c.material.uniforms.uTime.value=this.timeMs,c.material.uniforms.uHead.value=+(e.pillarReach<1),this.stand(c,t,a,s,(n+o)/2,r*.9*e.pillarWidth,n-o)}let m=e.timing.pillar.strikeRingMs;if(e.strikeAgeMs!==null&&e.strikeAgeMs<m){let t=this.strike??=this.ground(ws,{uCore:{value:ps(l.otherworldRiftCore)},uGlow:{value:ps(l.otherworldRift)},uLife:{value:0}},o.decal-3),n=r*1.4;t.position.set(a,s,.039),t.scale.set(n*2,n*2,1),t.material.uniforms.uLife.value=e.strikeAgeMs/m,t.visible=!0}if(e.streak>.05){let n=e.timing.drop.streakInWidths*e.streak*i,o=(e.machineBottomInWidths+1.3)*i,c=this.streak??=this.billboard(Ts,{uCore:{value:ps(l.otherworldRiftCore)},uAlpha:{value:0}});c.material.uniforms.uDepth.value=t.depthOf(f)+1e-5,c.material.uniforms.uAlpha.value=.75*e.streak,this.stand(c,t,a,s,o+n/2,r*1.1,n)}if(e.rift>.01){let n=this.rift??=this.billboard(Es,{uGlow:{value:ps(l.otherworldRift)},uCore:{value:ps(l.otherworldRiftCore)},uInk:{value:ps(l.villageShadowInk)},uOpen:{value:0},uTime:{value:0},uSeed:{value:2.1}});n.material.uniforms.uDepth.value=t.depthOf(e.point)+3e-5,n.material.uniforms.uOpen.value=e.rift,n.material.uniforms.uTime.value=this.timeMs,this.stand(n,t,a,s,e.timing.rift.heightInWidths*i,r*2.3,i*2.3*.5)}}dispose(){for(let e of[this.shadow,this.crack,this.ring,this.pillar,this.rift,this.strike,this.streak,...[...this.dust,...this.debris,...this.splash].map(e=>e.mesh)])e&&(this.world.remove(e),e.geometry.dispose(),e.material.dispose());this.shadow=this.crack=this.ring=this.pillar=this.rift=this.strike=this.streak=null,this.dust.length=0,this.debris.length=0,this.splash.length=0}hideAll(){for(let e of[this.shadow,this.crack,this.ring,this.pillar,this.rift,this.strike,this.streak])e&&(e.visible=!1);for(let e of[...this.dust,...this.debris,...this.splash])e.mesh.visible=!1}puffs(e,t,n,r,i){let a=e.timing.impact;for(;this.dust.length<a.dustCount;){let e=this.dust.length,t=Ds(e+1);this.dust.push({mesh:this.billboard(xs,{uColor:{value:ps(l.otherworldDebrisLight)},uShade:{value:ps(l.otherworldDust)},uAlpha:{value:0},uSeed:{value:t*6}}),angle:(e&1?0:Math.PI)+(t-.5)*1.4,reach:1.15+.7*Ds(e+11),lift:.04+.1*Ds(e+21),size:.38+.2*Ds(e+31),delay:e<4?0:30+50*Ds(e+41),life:a.dustMs*(.75+.25*Ds(e+51)),spin:0})}let o=Math.atan2(t.right.y,t.right.x);for(let a of this.dust){let s=(i-a.delay)/a.life;if(s<0||s>=1)continue;let c=1-(1-s)**3,l=n*(.5+(a.reach-.5)*c),u=o+a.angle,d=e.point[0]+Math.cos(u)*l,f=e.point[1]+Math.sin(u)*l,p=a.size*(.55+.75*c);a.mesh.material.uniforms.uAlpha.value=.7*(s<.2?1:(1-(s-.2)/.8)**1.5),a.mesh.material.uniforms.uDepth.value=t.depthOf([d,f]),this.stand(a.mesh,t,d,f,r*(p*.3+a.lift*c),n*p,r*p*.6)}}chips(e,t,n,r,i){let a=e.timing.impact;for(;this.debris.length<a.debrisCount;){let e=this.debris.length,t=Ds(e+101),n=e<3;this.debris.push({mesh:this.billboard(Ss,{uColor:{value:ps(l.otherworldDebris)},uLight:{value:ps(l.otherworldDebrisLight)},uInk:{value:ps(l.otherworldCrackInk)},uAlpha:{value:1},uSeed:{value:t*6}}),angle:e*2.39996+1.1+t,reach:.8+.9*Ds(e+111),lift:.25+.3*Ds(e+121),size:n?.13+.03*Ds(e+131):.05+.04*Ds(e+131),delay:25*Ds(e+141),life:a.debrisMs*(.8+.2*Ds(e+151)),spin:(Ds(e+161)-.5)*1.4})}this.arcs(this.debris,e,t,n,r,i)}drops(e,t,n,r,i){let a=e.timing.impact;for(;this.splash.length<a.splashCount;){let e=this.splash.length,t=Ds(e+201);this.splash.push({mesh:this.billboard(Ss,{uColor:{value:ps(l.otherworldRift)},uLight:{value:ps(l.otherworldRiftCore)},uInk:{value:ps(l.otherworldRift)},uAlpha:{value:1},uSeed:{value:t*6}}),angle:e*1.0472+t,reach:.5+.5*Ds(e+211),lift:.5+.3*Ds(e+221),size:.05,delay:10*Ds(e+241),life:a.splashMs,spin:0})}this.arcs(this.splash,e,t,n,r,i)}arcs(e,t,n,r,i,a){for(let o of e){let e=(a-o.delay)/o.life;if(e<=0||e>=1)continue;let s=Math.min(1,e/.7),c=r*(.48+o.reach*s),l=t.point[0]+Math.cos(o.angle)*c,u=t.point[1]+Math.sin(o.angle)*c,d=i*o.lift*4*s*(1-s);o.mesh.material.uniforms.uAlpha.value=e<.8?1:1-(e-.8)/.2,o.mesh.material.uniforms.uDepth.value=n.depthOf([l,u]),this.stand(o.mesh,n,l,u,d+i*o.size*.5,r*o.size,i*o.size,o.spin*a*.02)}}stand(e,t,n,r,i,a,o,s=0){e.position.set(n,r,i),e.quaternion.setFromRotationMatrix(t.basis),s!==0&&e.quaternion.multiply(new Kt().setFromAxisAngle(new Z(0,0,1),s)),e.scale.set(a,o,1),e.visible=!0}ground(e,t,n){let r=new q(new vt(1,1),gs(e,t));return r.frustumCulled=!1,r.renderOrder=n,r.visible=!1,this.world.add(r),r}billboard(e,t,n=!1){let r=new q(new vt(1,1),_s(e,t,n));return r.frustumCulled=!1,r.visible=!1,this.world.add(r),r}},ks=class{world;meshes=[];constructor(e){this.world=e;let t=re(B.flatMap(([e,t])=>[[e,t,0],[e,t,oe.height]]));this.add(t,.17,.7),this.add(B,.32,.25)}add(e,t,n){let r=[0,1].map(t=>Math.min(...e.map(e=>e[t]))-n),i=[0,1].map(t=>Math.max(...e.map(e=>e[t]))+n),a=Array.from({length:8},()=>new K);e.forEach((t,n)=>{let r=e[(n+1)%e.length];a[n].set(t[0],t[1],r[0],r[1])});let s=new J({uniforms:{edges:{value:a},count:{value:e.length},opacity:{value:t},softness:{value:n},ink:{value:new Y(l.villageShadowInk)}},transparent:!1,depthWrite:!1,depthTest:!1,side:2,blending:5,blendSrc:204,blendDst:205,blendSrcAlpha:201,blendDstAlpha:205,vertexShader:`varying vec2 wp;void main(){vec4 p=modelMatrix*vec4(position,1.);wp=p.xy;gl_Position=projectionMatrix*viewMatrix*p;}`,fragmentShader:`uniform vec4 edges[8];uniform int count;uniform float opacity,softness;uniform vec3 ink;varying vec2 wp;
        void main(){bool inside=false;float dist=1000.;
          for(int i=0;i<8;i++){if(i>=count)break;vec2 a=edges[i].xy,b=edges[i].zw,d=b-a;
            float t=clamp(dot(wp-a,d)/max(dot(d,d),.0001),0.,1.);dist=min(dist,length(wp-a-t*d));
            if((a.y>wp.y)!=(b.y>wp.y)){if(wp.x<(b.x-a.x)*(wp.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}}
          gl_FragColor=vec4(ink,opacity*(1.-smoothstep(-softness,softness,inside?-dist:dist)));
          #include <colorspace_fragment>
        }`}),c=new q(new vt(i[0]-r[0],i[1]-r[1]),s);c.position.set((r[0]+i[0])/2,(r[1]+i[1])/2,.035),c.renderOrder=o.actorShadow,c.visible=!1,c.frustumCulled=!1,this.world.add(c),this.meshes.push(c)}update(e){this.meshes.forEach(t=>{t.visible=e})}dispose(){this.meshes.forEach(e=>{this.world.remove(e),e.geometry.dispose(),e.material.dispose()})}},As=class{elapsedMs=0;awning=null;registerAwning(e){let t=Oe;if(!e.fragmentShader.includes(t))throw Error(`Awning face shader changed`);e.uniforms.plazaTime={value:0},e.fragmentShader=`uniform float plazaTime;\n${e.fragmentShader}`.replace(t,`
      // Fixed paint and silhouette; only broad sunlight on the canopy changes gently.
      float lightDrift = sin(at.x*12. + at.y*3. + plazaTime*.48)*.014;
      gl_FragColor.rgb *= 1. + lightDrift;
      ${t}`),this.awning=e}update(e,t,n){n&&!t&&(this.elapsedMs=(this.elapsedMs+Math.max(0,Math.min(e,100)))%1e6);let r=t?0:this.elapsedMs/1e3;this.awning&&(this.awning.uniforms.plazaTime.value=r)}},js=new Set([I,...ln]),Ms=`native-city-3d`,Ns=4,Ps=30,Fs=Object.freeze({frameMs:12,sliceBytes:8*n,minSliceBytes:n,layer:31,giveUpMs:4e3}),Is=8,Ls=2e4,Rs=192*n,zs=18e4,Bs=12e4,Vs=2e3,Hs=e=>(e%360+360)%360,Us=12,Ws=32;function Gs(){let e=new We({side:2,alphaTest:.15}),t={value:0};return e.userData.cardFill=t,e.onBeforeCompile=e=>{e.uniforms.cardFill=t,e.fragmentShader=`uniform float cardFill;
`+e.fragmentShader.replace(`#include <map_fragment>`,`#include <map_fragment>
	diffuseColor.rgb = mix(diffuseColor.rgb, diffuse, cardFill);`)},e.customProgramCacheKey=()=>`native-city-card-fill`,e}var Ks=4,qs=3,Js=class{scene;definition;kaPilotCutaway=new eo;kaPilotHiddenFaces=[];occluders=null;occlusionBody=null;occlusionLens=null;renderer=new Ka({antialias:!0});world=new Ut;camera=new Zt;abort=new AbortController;textures=new Map;imageTextures=new Map;compressedPending=new Set;bitmaps=new Set;reloadingTextures=!1;cards=new Map;backdropAlpha=0;backdropKeep=[];backdropMode=`dim`;backdropClockMs=0;decisiveFrame=null;backdropSheet=null;actorShadows=new os(this.world);floorDecals=new ss(this.world);catVendingImpact=new Os(this.world);catVendingShadow=new ks(this.world);catVendingFrame=null;ottoProps=new ue(this.world,e=>{let t=this.imageTextures.get(e);return t||this.loadOnDemand([e]),t??null});ottoPropState=null;plazaProps=new ue(this.world,e=>{let t=this.imageTextures.get(e);return t||this.loadOnDemand([e]),t??null},se,`native-city-plaza-prop`);plazaPropState=null;pendingDecals=[];buildings=[];suppressed=new so;underlay;releaseStats;ground=null;plazaRoute=[];plazaDialogueCenter=[0,0];setPlazaRoute(e,t=e[0]??[0,0]){this.plazaRoute=e,this.plazaDialogueCenter=t,this.ground&&Uo(this.ground.material,{points:e,dialogueCenter:t})}daySky;silhouette=null;ready=!1;shopFinishing=null;streetFinishing=null;groundShadow=null;propVolumes=null;townKit=null;plazaAtmosphere=new As;destroyed=!1;failure=null;active=!1;frames=0;lastGameFrame=-1;lastRenderMs=0;angle=0;estateGateOpen=!1;buildingPreview=!1;plazaVending=!1;fightBodies=null;unifiedPaving=!1;layoutGuide=new ao;foundationCalibratedCards=0;foundationMaxError=0;foundationFacingFailures=0;constructor(e,t){this.scene=e,this.definition=t,this.renderer.setSize(e.scale.width,e.scale.height,!1);let n=this.definition.ground.registeredCityPlan?l.villageSea:l.cityDaySkyHorizon;this.renderer.setClearColor(n),this.daySky=new Do(n),this.renderer.outputColorSpace=wt,this.renderer.domElement.classList.add(Ms),this.underlay=u(e.game,this.renderer.domElement),this.releaseStats=c({title:`city 3D (three)`,read:()=>this.renderStats(),sharedSources:()=>[...this.textures].filter(([,e])=>this.isUploaded(e)).map(([e])=>e)}),this.renderer.domElement.addEventListener(`webglcontextlost`,()=>{this.reloadingTextures=!0},{signal:this.abort.signal}),this.renderer.domElement.addEventListener(`webglcontextrestored`,()=>{this.reloadClosedTextures()},{signal:this.abort.signal}),this.world.add(this.daySky.mesh),this.world.add(this.layoutGuide.root),this.world.add(this.layoutGuide.parcels),this.load()}async loadTexture(e){let t=S(e);if(t!==null){let n=await Ce(e)??await gn(await w(t.ktx2,this.abort.signal),t.linear);if(this.destroyed){n.dispose();return}n.anisotropy=t.mipmaps?Math.min(16,this.renderer.capabilities.getMaxAnisotropy()):1,n.userData.ktx2=t.ktx2,n.userData.linear=t.linear,this.releaseCompressedAfterUpload(n),this.imageTextures.set(e,n),this.warmComplete=!1;return}let n=this.definition.buildings.some(t=>t.paintedVolume?.lightmap?.path===e||t.paintedVolume?.groundShadow?.path===e),r=await Se(e)??await xe(e,this.abort.signal,n);if(this.destroyed){r.close();return}if(ke.paths.includes(e)||e===P.path||e===te.path){let t=await mo(r);if(this.destroyed){t.dispose();return}this.imageTextures.set(e,t),this.warmComplete=!1;return}let i=new Gt(r);i.flipY=!1,i.colorSpace=n?``:wt,i.minFilter=n?cn:Fe,i.generateMipmaps=!n,i.magFilter=cn,i.anisotropy=Math.min(16,this.renderer.capabilities.getMaxAnisotropy()),(n||js.has(e))&&(i.generateMipmaps=!1,i.minFilter=cn,i.anisotropy=1),i.needsUpdate=!0,this.retainUntilUploaded(i,r),this.imageTextures.set(e,i),this.warmComplete=!1}releaseCompressedAfterUpload(e){this.compressedPending.add(e),e.onUpdate=()=>{this.compressedPending.delete(e);let t=e.mipmaps[0];t&&(e.userData.uploadedSize=[t.width,t.height]),e.userData.mipLevels=e.mipmaps.length,e.mipmaps=[]}}retainUntilUploaded(e,t){this.bitmaps.add(t),e.onUpdate=()=>{this.bitmaps.delete(t)&&(e.userData.uploadedSize=[t.width,t.height],t.close())}}warmCardTexture(e){this.destroyed||!this.scene.textures.exists(e)||this.actorTexture(this.scene.textures.getFrame(e,0),!1)}prepareActorTexture(e){if(!e.includes(`-side-`)&&!e.includes(`-side_left-`)&&!e.startsWith(`personal-player-`)||this.destroyed||!this.scene.textures.exists(e))return;let t=this.scene.textures.getFrame(e,0);this.actorTexture(t,!1);let n=t.source.image;this.preparedActors.has(n)||(this.preparedActors.add(n),this.preparedUploads.add(n))}keepActorSheets(e){this.keptActorKeys=[...e],this.warmKeptActors()}keptActorKeys=[];get keptActorSheetsReady(){return this.keptActorKeys.every(e=>{if(!this.scene.textures.exists(e))return!0;let t=this.textures.get(this.scene.textures.getFrame(e,0).source.image);return t!==void 0&&t.userData.decoding!==!0})}actorSheetReady(e){return this.destroyed||!this.scene.textures.exists(e)?!1:this.actorTexture(this.scene.textures.getFrame(e,0),!1)!==null}warmKeptActors(){for(let e of this.keptActorKeys){if(!this.scene.textures.exists(e))continue;let t=this.scene.textures.getFrame(e,0),n=t.source.image;this.textures.has(n)||(this.actorTexture(t,!1),this.preparedUploads.add(n))}}preparedActors=new Set;preparedUploads=new Set;uploadPreparedActors(){if(this.warmDisabled||this.preparedUploads.size===0)return;let e=performance.now();for(let t of this.preparedUploads){let n=this.textures.get(t);if(!n){this.preparedUploads.delete(t);continue}if(!n.userData.decoding&&(this.preparedUploads.delete(t),!this.isUploaded(n)&&(this.renderer.initTexture(n),performance.now()-e>Ns)))break}}actorTexture(e,n){let r=e.source.image,o=this.textures.get(r);if(o)return o.userData.lastUsedMs=performance.now(),o.userData.decoding?null:o;let s=e.source.texture.key,c=new Gt;c.colorSpace=wt,c.minFilter=cn,c.magFilter=cn,c.generateMipmaps=!1,c.userData.lastUsedMs=performance.now(),c.userData.text=n,this.textures.set(r,c),n||a(this.scene.game,e.source);let l=n?void 0:t(s);if(!l||!(r instanceof HTMLImageElement))return c.image=r,c.needsUpdate=!0,c;let u=S(l);return u===null?(this.decodeActorSheet(c,e,l),null):(c.userData.decoding=!0,w(u.ktx2,this.abort.signal).then(e=>gn(e,u.linear)).then(e=>{if(this.destroyed||this.textures.get(r)!==c){e.dispose();return}e.minFilter=cn,e.magFilter=cn,e.premultiplyAlpha=!1,e.userData.lastUsedMs=c.userData.lastUsedMs,e.userData.ktx2=u.ktx2,e.userData.actor=!0,u.padded&&(e.userData.uvSize=u.padded),this.releaseCompressedAfterUpload(e),this.textures.set(r,e),c.dispose()}).catch(()=>{if(!this.destroyed){if(i(e.source)){this.decodeActorSheet(c,e,l);return}c.image=r,c.needsUpdate=!0,c.userData.decoding=!1}}),null)}decodeActorSheet(e,t,n){let r=t.source.image;e.userData.decoding=!0,fetch(n,{signal:this.abort.signal}).then(e=>{if(!e.ok)throw Error(`HTTP ${e.status}`);return e.blob()}).then(e=>{let r=fs(n),i=t.source;return createImageBitmap(e,{imageOrientation:`flipY`,premultiplyAlpha:`none`,...r<1?{resizeWidth:Math.max(1,Math.round(i.width*r)),resizeHeight:Math.max(1,Math.round(i.height*r)),resizeQuality:`high`}:{}})}).then(t=>{if(this.destroyed){t.close();return}e.image=t,e.flipY=!1,this.retainUntilUploaded(e,t)}).catch(()=>{this.destroyed||(i(t.source)?e.userData.unavailable=!0:e.image=r)}).finally(()=>{this.destroyed||e.userData.unavailable||(e.needsUpdate=!0,e.userData.decoding=!1)})}onDemandLoading=new Set;loadOnDemand(e){for(let t of e)this.imageTextures.has(t)||this.onDemandLoading.has(t)||(this.onDemandLoading.add(t),this.loadTexture(t).catch(e=>{this.destroyed||(this.failure=`on-demand card ${t}: ${String(e)}`)}).finally(()=>this.onDemandLoading.delete(t)))}async reloadClosedTextures(){this.reloadingTextures=!0;for(let[e,t]of this.textures){if(t instanceof Bt){this.dropActorTexture(e,t);continue}let n=t.image;n instanceof ImageBitmap&&n.width===0&&(t.image=e,t.flipY=!0,t.needsUpdate=!0)}try{await Promise.all([...this.imageTextures].map(async([e,t])=>{if(t instanceof yt||this.destroyed)return;if(t instanceof Bt){if(t.mipmaps.length>0||typeof t.userData.ktx2!=`string`)return;let e=await gn(await w(t.userData.ktx2,this.abort.signal),t.userData.linear===!0);if(this.destroyed){e.dispose();return}t.mipmaps=e.mipmaps,t.needsUpdate=!0;return}let n=t.image;if(n&&n.width>0)return;let r=await xe(e,this.abort.signal,t.colorSpace===``);if(this.destroyed){r.close();return}t.image=r,t.needsUpdate=!0,this.retainUntilUploaded(t,r)}))}catch(e){this.destroyed||(this.failure=`texture reload after context loss: ${String(e)}`)}finally{this.reloadingTextures=!1}}async load(){try{let[e,t,n,r]=this.definition.ground.bounds;if(![e,t,n,r].every(Number.isFinite)||n<=e||r<=t)throw Error(`Invalid city card ground bounds`);let i=this.definition.ground.materials;if(i&&(i.stoneFrame?.origin.length!==2||i.stoneFrame?.uvFromPlan.length!==4||![...i.stoneFrame.origin,...i.stoneFrame.uvFromPlan].every(Number.isFinite)))throw Error(`Invalid city paving frame`);if(i&&(![H.ground.stoneRepeatPlan,i.meadowRepeat,i.plazaRadius,i.plazaFeather].every(e=>Number.isFinite(e)&&e>0)||!i.plazaAnchor.every(Number.isFinite)))throw Error(`Invalid city card ground materials`);let a=new Set;for(let e of this.definition.buildings){if(a.has(e.id)||!e.variants.length&&!e.paintedVolume?.faces.length||!e.anchor.every(Number.isFinite))throw Error(`Invalid city card ${e.id}`);a.add(e.id);let t=new Set;for(let n of e.variants){let r=Hs(n.angle);if(!Number.isFinite(r)||t.has(r)||!Number.isFinite(n.width)||!Number.isFinite(n.height)||n.width<=0||n.height<=0||!n.origin.every(Number.isFinite))throw Error(`Invalid city card variant ${e.id}`);if(t.add(r),n.foundation&&!Ao(n.foundation))throw Error(`Invalid city card foundation ${e.id}`)}}if(await Promise.all(be(this.definition).map(e=>this.loadTexture(e))),this.destroyed)return;this.daySky.setCloudTexture(this.imageTextures.get(z.path)),this.ground=new q(new vt(n-e,r-t),Wo(this.definition.ground,this.imageTextures,this.buildingPreview,{points:this.plazaRoute,dialogueCenter:this.plazaDialogueCenter}));let o=this.ground.geometry.getAttribute(`uv`);for(let e=0;e<o.count;e++)o.setY(e,1-o.getY(e));o.needsUpdate=!0,this.ground.position.set((e+n)/2,(t+r)/2,-.01),this.ground.renderOrder=-(2**53-1)+1,this.world.add(this.ground);let s=he();for(let e of this.definition.buildings)if(this.addBuilding(e),await s.breathe(),this.destroyed)return;i&&(this.shopFinishing=new Ko(this.world,this.definition.buildings,this.imageTextures,this.imageTextures.get(i.stonePath)));let c=j(this.definition);if(c&&(this.groundShadow=new xo(this.world,this.imageTextures.get(P.path))),await Tn(this.definition.buildings,s,()=>this.destroyed),this.destroyed||(this.streetFinishing=new Dn(this.world,this.definition.buildings,c,this.imageTextures,this.definition.ground),await s.breathe(),this.destroyed)||(this.propVolumes=new es(this.world,this.definition.buildings,this.imageTextures),await On(this.definition.buildings,s,()=>this.destroyed),this.destroyed))return;this.townKit=new kn(this.world,this.definition.buildings,this.imageTextures);try{await this.renderer.compileAsync(this.world,this.camera)}catch{}if(this.destroyed)return;this.ready=!0}catch(e){this.destroyed||(this.failure=String(e),this.abort.abort())}}addBuilding(e){let t=e.variants.map(e=>({...e,angle:Hs(e.angle)})).sort((e,t)=>e.angle-t.angle),n=t.length?Math.min(...t.map(e=>-e.origin[0]*e.width)):0,r=t.length?Math.min(...t.map(e=>-e.origin[1]*e.height)):0,i=t.length?Math.max(...t.map(e=>(1-e.origin[0])*e.width))-n:1,a=t.length>1?Math.max(Math.abs(n),Math.abs(n+i))*.25:0,o=r-a,s=t.length?Math.max(...t.map(e=>(1-e.origin[1])*e.height))-r+a*2:1,c=new J({side:2,transparent:!0,depthTest:!0,depthWrite:!0,uniforms:{imageA:{value:null},imageB:{value:null},mixAmount:{value:0},cardDepth:{value:0},canvasBounds:{value:new K(n,o,i,s)},warpA:{value:new X(1,0)},warpB:{value:new X(1,0)},transformA:{value:new K},transformB:{value:new K},distanceMix:{value:0},distanceColor:{value:new Y(l.cityDaySkyHorizon)},foundationEnabled:{value:new X},foundationHeight:{value:new X(1,1)},continuousEnabled:{value:new X},inverseXA:{value:new Z},inverseYA:{value:new Z},inverseXB:{value:new Z},inverseYB:{value:new Z},foundationOmittedSide:{value:new X(-1,-1)},foundationSizes:{value:new K(1,1,1,1)},sourceXA:{value:new Z},sourceYA:{value:new Z},targetXA:{value:new Z},targetYA:{value:new Z},sourceXB:{value:new Z},sourceYB:{value:new Z},targetXB:{value:new Z},targetYB:{value:new Z}},vertexShader:`uniform float cardDepth; varying vec2 cardUv; void main() { cardUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = cardDepth * gl_Position.w; }`,fragmentShader:`
        uniform sampler2D imageA; uniform sampler2D imageB;
        uniform vec4 transformA; uniform vec4 transformB; uniform float mixAmount;
        uniform vec4 canvasBounds; uniform vec2 warpA; uniform vec2 warpB;
        uniform float distanceMix; uniform vec3 distanceColor;
        uniform vec2 foundationEnabled; uniform vec2 foundationHeight; uniform vec4 foundationSizes;
        uniform vec2 continuousEnabled; uniform vec3 inverseXA; uniform vec3 inverseYA; uniform vec3 inverseXB; uniform vec3 inverseYB;
        uniform vec2 foundationOmittedSide;
        uniform vec3 sourceXA; uniform vec3 sourceYA; uniform vec3 targetXA; uniform vec3 targetYA;
        uniform vec3 sourceXB; uniform vec3 sourceYB; uniform vec3 targetXB; uniform vec3 targetYB;
        varying vec2 cardUv;
        ${Ae}
        vec4 sampleCard(sampler2D image, vec4 transform, vec2 warp, float enabled, vec2 size, float heightScale,
          vec3 sourceX, vec3 sourceY, vec3 targetX, vec3 targetY, float omittedSide,
          float continuous, vec3 inverseX, vec3 inverseY) {
          vec2 point = vec2(canvasBounds.x + cardUv.x * canvasBounds.z,
            canvasBounds.y + (1.0 - cardUv.y) * canvasBounds.w);
          vec2 at;
          if (continuous > .5) {
            vec3 p = vec3(point, 1.0);
            at = vec2(dot(inverseX, p) / size.x, 1.0 - dot(inverseY, p) / size.y);
          } else if (enabled > .5) {
            // Inverse vertical-column mapping; no affine yaw warp is applied a second time.
            bool left = point.x <= targetX.y;
            if ((left && omittedSide == 0.0) || (!left && omittedSide == 1.0)) return vec4(0.0);
            vec2 tx = left ? targetX.xy : targetX.yz;
            vec2 ty = left ? targetY.xy : targetY.yz;
            vec2 sx = left ? sourceX.xy : sourceX.yz;
            vec2 sy = left ? sourceY.xy : sourceY.yz;
            float fraction = (point.x - tx.x) / (tx.y - tx.x);
            float sourcePixelX = mix(sx.x, sx.y, fraction);
            float sourceBase = mix(sy.x, sy.y, fraction);
            float targetBase = mix(ty.x, ty.y, fraction);
            float sourcePixelY = sourceBase + (point.y - targetBase) / heightScale;
            at = vec2(sourcePixelX / size.x, 1.0 - sourcePixelY / size.y);
          } else {
          // Inverse of x'=cos(delta)*x, y'=y+sin(pitch)*sin(delta)*x.
          // An upright registered plane keeps vertical walls straight and the ground anchor fixed.
          point.x /= warp.x;
          point.y -= warp.y * point.x;
          vec2 registered = vec2((point.x - canvasBounds.x) / canvasBounds.z,
            1.0 - (point.y - canvasBounds.y) / canvasBounds.w);
          at = registered * transform.xy + transform.zw;
          }
          if (any(lessThan(at, vec2(0.0))) || any(greaterThan(at, vec2(1.0)))) return vec4(0.0);
          vec4 color = texture2D(image, at); color.rgb *= color.a; return color;
        }
        void main() {
          vec4 color = mix(sampleCard(imageA, transformA, warpA, foundationEnabled.x, foundationSizes.xy, foundationHeight.x,
            sourceXA, sourceYA, targetXA, targetYA, foundationOmittedSide.x, continuousEnabled.x, inverseXA, inverseYA),
            sampleCard(imageB, transformB, warpB, foundationEnabled.y, foundationSizes.zw, foundationHeight.y,
            sourceXB, sourceYB, targetXB, targetYB, foundationOmittedSide.y, continuousEnabled.y, inverseXB, inverseYB), mixAmount);
          if (color.a < 0.15) discard;
          // Local card grading preserves every painted edge and the opaque silhouette.
          gl_FragColor = vec4(cityAtmosphere(color.rgb / color.a, distanceColor, distanceMix), color.a);
          #include <colorspace_fragment>
        }`}),u=new q(new vt(1,1),c);u.frustumCulled=!1;let d=e.paintedVolume?_n(e.paintedVolume):void 0,f=e.paintedVolume&&!d?this.addPaintedFaces(e.paintedVolume,e.id):void 0;this.buildings.push({definition:e,variants:t,mesh:u,left:n,top:o,width:i,height:s,paintedFaces:f}),this.world.add(u)}addPaintedFaces(e,t){if(e.faces.length&&e.faces.every(e=>e.painterly))return is(this.world,e,this.imageTextures);let n=e.lightmap??un[t];for(let t of e.faces){if(!t.repeatPlan&&!t.repeatTexture)continue;let e=this.imageTextures.get(t.path);e.wrapS=e.wrapT=t.mirroredRepeat?mt:Ge,e.needsUpdate=!0}let r=bn(e,t),i=r.singles.map(({face:r,grid:i,lightUv:a,surfaceNormals:o})=>{let s=this.imageTextures.get(r.path),c=new _t;c.setAttribute(`position`,new Re(i.positions,3)),c.setAttribute(`uv`,new Re(i.uv,2)),c.setIndex(i.indices),o&&c.setAttribute(`surfaceNormalWorld`,new Re(o,3)),a&&c.setAttribute(`lightUv`,new Re(a,2));let l=zo(e,r,s,this.imageTextures,a?n:void 0);t===`B001`&&r.id===`awning-canopy`&&r.part===`awning`&&this.plazaAtmosphere.registerAwning(l);let u=new q(c,l);c.computeBoundingSphere(),u.matrixAutoUpdate=!1;let d=r.part===`estate-floor`?-(2**53-1)+(a?9:7):yn(r.id)?-(2**53-1)+7:void 0;return r.part===`estate-floor`&&(l.transparent=!1,l.depthTest=!1,l.depthWrite=!1,l.blending=5,l.blendSrc=204,l.blendDst=205,l.blendSrcAlpha=201,l.blendDstAlpha=205),d!==void 0&&(u.renderOrder=d),this.world.add(u),{id:r.id,normal:fn(e,r),twoSided:r.twoSided??!1,mesh:u,fixedOrder:d}});for(let{key:a,first:o,variant:s,faceIds:c,arrays:l}of r.batches){let r=zo(e,o,this.imageTextures.get(o.path),this.imageTextures,s===`light`?n:void 0,s),u=new q(xn(l),r);u.matrixAutoUpdate=!1,u.name=`painted-batch-${t}-${a}`,this.world.add(u),i.push({id:`batch:${a}`,normal:[0,0,0],twoSided:!0,mesh:u,batch:{faceIds:[...c]}})}return i}setBuildingPreview(e){this.buildingPreview=e}setFloorDecals(e){this.pendingDecals=e}setCatVendingImpact(e){this.catVendingFrame=e}setBackdropDim(e,t,n=`dim`,r=0){this.backdropAlpha=Number.isFinite(e)?Math.max(0,Math.min(1,e)):0,this.backdropKeep=t,this.backdropMode=n,this.backdropClockMs=r,this.decisiveFrame||(this.decisiveFrame=new po).warm(this.renderer)}setOttoProps(e){this.ottoPropState=e}setPlazaProps(e){this.plazaPropState=e}get rendering(){return this.active}setPlazaVending(e){this.plazaVending=e}setFightBodies(e,t=0,n=[]){this.fightBodies=e&&e.length?{points:e,radius:t,fighters:n}:null}fightVeil(e,t,n,r,i,a){let o=r?Math.min(...r.points.map(e=>Math.hypot(e[0]-n[0],e[1]-n[1]))):1/0,s=r!==null&&t!==null&&as(t,!1)&&!r.fighters.includes(t)&&o>=.5*r.radius&&(this.propHidesFight({id:t,anchor:n,radius:Ks*r.radius},r)||o<qs*r.radius&&this.spanMeetsFight(n,r.radius,r))?ce.alpha:1,c=e.userData.fightVeil??1,l=fe(c,s,Math.max(0,i),a);return e.userData.fightVeil=l,l}propHidesFight(e,t){let n=Math.min(...t.points.map(e=>this.anchorDepth(e)));return this.anchorDepth(e.anchor)<n&&this.spanMeetsFight(e.anchor,e.radius,t)}spanMeetsFight(e,t,n){let r=this.camera.projectionMatrix.elements,i=e=>(r[0]*e[0]+r[4]*e[1]+r[12])/(r[3]*e[0]+r[7]*e[1]+r[15]),a=(e,t)=>{let n=1/0,r=-1/0;for(let a=0;a<8;a++){let o=a*Math.PI/4,s=i([e[0]+Math.cos(o)*t,e[1]+Math.sin(o)*t]);n=Math.min(n,s),r=Math.max(r,s)}return[n,r]},o=1/0,s=-1/0;for(let e of n.points){let[t,r]=a(e,n.radius);o=Math.min(o,t),s=Math.max(s,r)}let[c,l]=a(e,t);return c<s&&l>o}setLayoutReview(e,t=!0){this.layoutGuide.root.visible=t&&e!==`off`,this.layoutGuide.parcels.visible=e===`proposal`,this.unifiedPaving=e===`proposal`,this.shopFinishing?.setUnifiedPaving(this.unifiedPaving);let n=this.imageTextures.get(e===`proposal`?le.maskPath:_e.maskPath);if(n&&this.ground?.material instanceof J){if(this.ground.material.uniforms.compositionMask.value===n)return;(n.colorSpace!==``||n.minFilter!==1006||n.magFilter!==1006||n.generateMipmaps)&&(n.colorSpace=``,n.minFilter=n.magFilter=cn,n.generateMipmaps=!1,n.needsUpdate=!0),this.ground.material.uniforms.compositionMask.value=n}}setEstateGateOpen(e){if(e===this.estateGateOpen)return;let t=this.buildings.find(e=>e.definition.id===`B142`);if(!(!t?.paintedFaces||!t.definition.paintedVolume)){for(let n of[`left`,`right`]){let r=`gate-`+n,i=t.definition.paintedVolume.faces.find(e=>e.id===r),a=t.paintedFaces.find(e=>e.id===r);if(!i||!a)continue;let o=i.vertices.map(r=>T(t.definition.paintedVolume.vertices[r],n,e)),s=hn({vertices:o,faces:[]},{...i,vertices:[0,1,2,3]},1);a.mesh.geometry.setAttribute(`position`,new Re(s.positions,3)),a.mesh.geometry.computeBoundingSphere()}this.estateGateOpen=e}}suppress(e){this.suppressed.suppress(e)}restore(){this.suppressed.restoreAll()}anchorDepth(e){let t=this.camera.projectionMatrix.elements;return(t[2]*e[0]+t[6]*e[1]+t[14])/(t[3]*e[0]+t[7]*e[1]+t[15])}setCardDepth(e,t){let n=e.userData.cardDepth;n||(n={value:t},e.userData.cardDepth=n,e.onBeforeCompile=e=>{e.uniforms.cardDepth=n,e.vertexShader=`uniform float cardDepth;\n${e.vertexShader}`.replace(`#include <project_vertex>`,`#include <project_vertex>
gl_Position.z = cardDepth * gl_Position.w;`)},e.customProgramCacheKey=()=>`native-city-card-anchor-depth`,e.needsUpdate=!0),n.value=t}place(e,t,n,r,i,a,o,s,c,l=.03){let u=n/a,d=r/o;e.position.set(t[0]+s.x*(.5-i[0])*u,t[1]+s.y*(.5-i[0])*u,(i[1]-.5)*d+l),e.quaternion.setFromRotationMatrix(c),e.scale.set(u,d,1)}tilt(e,t,n,r){let i=new Kt().setFromAxisAngle(new Z(0,0,1),-t*Math.PI/180),a=new Z((n-.5)*e.scale.x,(.5-r)*e.scale.y,0);e.position.add(a.clone().applyQuaternion(e.quaternion)).sub(a.applyQuaternion(i).applyQuaternion(e.quaternion)),e.quaternion.multiply(i)}updateBuildings(e,t,n,r,i,a,o,s){this.shopFinishing?.updateDepth(e=>this.anchorDepth(e)),this.streetFinishing?.update(this.buildingPreview,this.plazaVending),this.groundShadow?.update(this.buildingPreview),this.foundationCalibratedCards=0,this.foundationMaxError=0,this.foundationFacingFailures=0;for(let c of this.buildings){if(this.townKit?.has(c.definition.id)){c.mesh.visible=!1;continue}if(this.propVolumes?.has(c.definition.id)){c.mesh.visible=!1;continue}if(this.plazaVending&&c.definition.id===`fountain`){c.mesh.visible=!1;continue}let{variants:l,mesh:u}=c;if(!En(c.definition.id,this.buildingPreview)){u.visible=!1;for(let e of c.paintedFaces??[])e.mesh.visible=!1;continue}if(c.paintedFaces){u.visible=!1;let e=a.projection,t=s.toward,n=e.perspective?m(e.perspective):null,r=this.anchorDepth(c.definition.anchor),i=De(c.definition.anchor,o,s.viewDepth);for(let e of c.paintedFaces){if(e.mesh.material.uniforms.distanceMix.value=i,e.batch){let i=e.mesh.material.uniforms;i.viewPerspective.value=+!!n,n&&i.viewEye.value.set(n[0],n[1],n[2]),i.viewToward.value.set(t[0],t[1],t[2]),e.mesh.visible=!0,e.mesh.renderOrder=-r;continue}let a=e.mesh.geometry.getAttribute(`position`),o=[a.getX(0),a.getY(0),a.getZ(0)];e.mesh.visible=e.twoSided||e.normal.reduce((e,r,i)=>e+r*(n?n[i]-o[i]:t[i]),0)>0,this.unifiedPaving&&c.definition.id.startsWith(`preview-shop-`)&&e.id===`court`&&(e.mesh.visible=!1),e.fixedOrder===void 0?e.mesh.renderOrder=-r+(e.id===`sign`?2e-5:e.id.startsWith(`roof`)?1e-5:0):e.mesh.renderOrder=e.fixedOrder}this.foundationCalibratedCards++;continue}let d=l[l.length-1],f=l[0],p=d.angle,h=f.angle+360,g=e<p?e+360:e;for(let t=0;t<l.length-1;t++)if(e>=l[t].angle&&e<=l[t+1].angle){d=l[t],f=l[t+1],p=d.angle,h=f.angle,g=e;break}let _=u.material.uniforms,v=l.length===1?0:Math.max(0,Math.min(1,(g-(p+h)/2+Us/2)/Us)),y=v*v*(3-2*v),b=new Map;for(let e of l)e.foundation&&b.set(e,Io(e.foundation,c.definition.anchor,a.projection));let x=e=>e.foundation?b.get(e)?.facing??0:1,S=(1-y+y*(1-x(f)))*x(d),C=(y+(1-y)*(1-x(d)))*x(f);if(u.visible=!0,S+C>1e-6)y=C/(S+C);else{let t=[...l].filter(e=>x(e)>1e-6).sort((t,n)=>Math.abs(Hs(e-t.angle+180)-180)-Math.abs(Hs(e-n.angle+180)-180))[0];if(!t){u.visible=!1,this.foundationFacingFailures++;continue}d=f=t,y=0}let w=[d,f].map(e=>b.get(e)??null);w.some((e,t)=>e&&(t===0?y<1:y>0))&&(this.foundationCalibratedCards++,this.foundationMaxError=Math.max(this.foundationMaxError,...w.map(e=>e?.maxError??0)));let T=[d,f].map((e,t)=>w[t]?.bounds??[-e.origin[0]*e.width,-e.origin[1]*e.height,(1-e.origin[0])*e.width,(1-e.origin[1])*e.height]);b.size&&(c.left=Math.min(...T.map(e=>e[0]))-2,c.top=Math.min(...T.map(e=>e[1]))-2,c.width=Math.max(...T.map(e=>e[2]))+2-c.left,c.height=Math.max(...T.map(e=>e[3]))+2-c.top,_.canvasBounds.value.set(c.left,c.top,c.width,c.height));let E=(e,t)=>{if(e)for(let[n,r,i]of[[`sourceX`,e.source.imageCorners,0],[`sourceY`,e.source.imageCorners,1],[`targetX`,e.target,0],[`targetY`,e.target,1]])_[`${n}${t}`].value.set(r[0][i],r[1][i],r[2][i])};E(w[0],`A`),E(w[1],`B`);for(let[e,t]of[`A`,`B`].entries()){let n=w[e]?.inverseRows;n&&(_[`inverseX${t}`].value.set(...n[0]),_[`inverseY${t}`].value.set(...n[1]))}if(_.continuousEnabled.value.set(+!!w[0]?.inverseRows,+!!w[1]?.inverseRows),_.foundationEnabled.value.set(+!!w[0],+!!w[1]),_.foundationOmittedSide.value.set(w[0]?.omittedSide??-1,w[1]?.omittedSide??-1),_.foundationHeight.value.set(w[0]?.source.heightScale??1,w[1]?.source.heightScale??1),_.foundationSizes.value.set(w[0]?.source.imageSize[0]??1,w[0]?.source.imageSize[1]??1,w[1]?.source.imageSize[0]??1,w[1]?.source.imageSize[1]??1),!this.imageTextures.has(d.path)||!this.imageTextures.has(f.path)){this.loadOnDemand([d.path,f.path]),u.visible=!1;continue}_.imageA.value=this.imageTextures.get(d.path),_.imageB.value=this.imageTextures.get(f.path),_.mixAmount.value=y;let D=Math.sqrt(Math.max(0,1-(n/t)**2)),O=(t,n)=>{let r=l.length===1?0:Math.max(-32,Math.min(Ws,Hs(e-t.angle+180)-180))*Math.PI/180;n.set(Math.cos(r),D*Math.sin(r))};O(d,_.warpA.value),O(f,_.warpB.value);let k=this.anchorDepth(c.definition.anchor);_.cardDepth.value=k,_.distanceMix.value=De(c.definition.anchor,o,s.viewDepth);let A=(e,t)=>t.set(c.width/e.width,c.height/e.height,c.left/e.width+e.origin[0],1-(c.top+c.height)/e.height-e.origin[1]);A(d,_.transformA.value),A(f,_.transformB.value),this.place(u,c.definition.anchor,c.width,c.height,[-c.left/c.width,-c.top/c.height],t,n,r,i,b.size?0:.03),u.renderOrder=-k}}update(e,t,n,r,i,a,o=0,s=0,c=!1){if(this.active=e&&this.ready&&!this.reloadingTextures&&!this.renderer.getContext().isContextLost(),this.underlay.setVisible(this.active),!this.active){if(this.restore(),e)for(let e of i)this.suppress(e);return}if(this.lastGameFrame===this.scene.game.loop.frame)return;this.lastGameFrame=this.scene.game.loop.frame,this.warmKeptActors();let u=performance.now(),g=t.projection,v=h(g),{scale:y,vertical:b}=v,x=new Z(...v.right),S=new Z(...v.direction),C=new Ke().makeBasis(x,new Z(0,0,1),new Z(x.y,-x.x,0)),w=n.width/n.zoom,T=n.height/n.zoom,E=n.scrollX+n.width/2-w/2,D=n.scrollY+n.height/2-T/2;this.camera.projectionMatrix.set(2*g.x[0]/w,2*g.y[0]/w,0,2*(g.origin[0]-E)/w-1,-2*g.x[1]/T,-2*g.y[1]/T,2*b/T,1-2*(g.origin[1]-D)/T,-S.x/d.camera.far,-S.y/d.camera.far,-S.z/d.camera.far,0,0,0,0,1),this.camera.projectionMatrix.fromArray(f(this.camera.projectionMatrix.elements,g.perspective)),this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();let O=Math.abs(Hs(o)-this.angle)>1e-6;this.angle=Hs(o);let k=a.getData(`spatialAnchor`),A=p(k?[k.x,k.y]:[a.x,a.y],t);if(this.ground?.material instanceof J){let e=this.ground.material.uniforms;e.compositionEnabled.value=this.buildingPreview&&!this.definition.ground.registeredCityPlan?1:0,e.distanceFocus.value.set(...A),e.distanceViewDepth.value.set(...v.viewDepth)}this.townKit?.update(!0,A,v.viewDepth),this.updateBuildings(this.angle,y,b,x,C,t,A,v);let j=this.fightBodies;this.propVolumes?.update(this.buildingPreview,this.plazaVending,s,c,e=>this.anchorDepth(e),e=>De(e,A,v.viewDepth),j?e=>this.propHidesFight(e,j):void 0),this.plazaAtmosphere.update(s,c,!document.hidden&&document.hasFocus()),this.daySky.update(s,c,!document.hidden&&document.hasFocus());for(let e of this.cards.values())e.visible=!1;this.actorShadows.beginFrame(),this.catVendingShadow.update(!1),this.silhouette&&(this.silhouette.visible=!1);let M=new Set(i);for(let e of r){if(M.has(e)||!(e instanceof co.default.GameObjects.Sprite||e instanceof co.default.GameObjects.Image||e instanceof co.default.GameObjects.Text&&e.name.startsWith(`native-city-sign-lettering-`)))continue;this.suppress(e);let n=this.cards.get(e);if(n||(n=new q(new vt(1,1),Gs()),n.frustumCulled=!1,this.cards.set(e,n),this.world.add(n)),n.visible=e.visible&&e.alpha>.01,!n.visible)continue;let r=e.frame,i=e instanceof co.default.GameObjects.Text,o=this.actorTexture(r,i),u=o?null:n.userData.lastFrame;if(!o&&!u){n.visible=!1;continue}let d=o??u.texture;i&&(d.needsUpdate=!0,n.material.polygonOffset=!0,n.material.polygonOffsetFactor=-1,n.material.polygonOffsetUnits=-4),n.material.map!==d&&(n.material.map=d,n.material.needsUpdate=!0),n.material.color.setHex(!i&&e.isTinted?e.tintTopLeft:l.white);let f=n.material.userData.cardFill;if(f&&(f.value=!i&&e.isTinted&&e.tintFill?1:0),o){let t=d.userData.uvSize??r.source,a=i?0:r.cutX/t.width,o=i?1:(r.cutX+r.cutWidth)/t.width,s=i?0:1-(r.cutY+r.cutHeight)/t.height,c=i?1:1-r.cutY/t.height,l=e.flipX?o:a,u=e.flipX?a:o,f=n.userData.lastFrame;if(!f||f.a!==l||f.b!==u||f.v0!==s||f.v1!==c){let e=n.geometry.getAttribute(`uv`);e.setXY(0,l,c),e.setXY(1,u,c),e.setXY(2,l,s),e.setXY(3,u,s),e.needsUpdate=!0}n.userData.lastFrame={texture:d,a:l,b:u,v0:s,v1:c,width:e.displayWidth,height:e.displayHeight,originX:e.originX,originY:e.originY}}let m=n.userData.lastFrame,h=e.getData(`spatialAnchor`),v=p(h?[h.x,h.y]:[e.x,e.y],t);if(!v.every(Number.isFinite)||g.perspective&&_(v,g.perspective)<=0){n.visible=!1;continue}let S=this.fightVeil(n,e===a?null:e.name,v,j,s,c),w=e.alpha*S;n.material.opacity=w;let T=w<.99&&(e.name.endsWith(`-ghost`)||S<1);n.material.transparent!==T&&(n.material.transparent=T,n.material.depthWrite=!T,n.material.polygonOffset=T,n.material.polygonOffsetFactor=+!!T,n.material.polygonOffsetUnits=T?4:0),n.material.alphaTest=T?.15*w:.15;let E=e.getData(`cardOverBodies`)===!0;if(n.renderOrder===1!==E&&(n.renderOrder=+!!E,n.material.depthTest=!E),e.name===`native-city-vending`&&this.catVendingShadow.update(!0),e.name!==`native-city-vending`&&as(e.name,e===a)){let n=!h&&!i&&e.angle===0?e.getData(`groundContacts`):void 0,a=e.x-m.originX*m.width,o=e.y-m.originY*m.height,s;if(n?.length){let i=n.map(t=>({x:e.flipX?1-t.x/r.cutWidth:t.x/r.cutWidth,y:t.y/r.cutHeight,rx:t.rx/r.cutWidth,ry:t.ry/r.cutHeight})),c=Math.min(...i.map(e=>e.x-e.rx)),l=Math.max(...i.map(e=>e.x+e.rx)),u=Math.min(...i.map(e=>e.y-e.ry)),d=Math.max(...i.map(e=>e.y+e.ry));s={corners:[[c,u],[l,u],[c,d]].map(([e,n])=>p([a+e*m.width,o+n*m.height],t)),contacts:i.map(e=>({x:(e.x-c)/(l-c),y:(e.y-u)/(d-u),rx:e.rx/(l-c),ry:e.ry/(d-u)}))}}this.actorShadows.update(e,v,e.displayHeight/b,e.alpha*S,s)}if(this.setCardDepth(n.material,this.anchorDepth(v)),this.place(n,v,m.width,m.height,[m.originX,m.originY],y,b,x,C,.03+(h?(h.y-e.y)/b:0)),!i&&e.angle!==0&&this.tilt(n,e.angle,m.originX,m.originY),e===a){this.silhouette??=new q(n.geometry,new We({color:l.loot,transparent:!0,opacity:.25,alphaTest:.15,side:2,depthFunc:6,depthWrite:!1}));let e=this.silhouette;this.setCardDepth(e.material,this.anchorDepth(v)),e.parent!==this.world&&this.world.add(e),e.visible=!0,e.frustumCulled=!1,e.renderOrder=2**53-1,e.material.map!==d&&(e.material.map=d,e.material.needsUpdate=!0),e.position.copy(n.position),e.quaternion.copy(n.quaternion),e.scale.copy(n.scale)}}this.kaPilotHiddenFaces=[];let N=this.cards.get(a);N?.updateMatrixWorld(!0),this.occlusionBody=N?{point:p([a.x,a.y],t),right:[x.x,x.y],width:N.scale.x,height:N.scale.y}:null,this.occlusionLens=g.perspective?{target:g.perspective.target,distance:g.perspective.distance}:null;let ee=N?[-.5,.5].map(e=>new Z(e,e,0).applyMatrix4(N.matrixWorld).applyMatrix4(this.camera.projectionMatrix)):[];if(N)for(let e of this.buildings){if(!e.paintedFaces||!e.definition.paintedVolume)continue;let n=this.kaPilotCutaway.update(e.definition.id,e.definition.paintedVolume,p([a.x,a.y],t),[S.x,S.y,S.z],[x.x,x.y],N.scale.x,N.scale.y);for(let t of e.paintedFaces){let e=t.mesh.material.uniforms;if(!e.pilotCutaway)continue;let r=n.has(t.id),i=t.mesh.material;i.transparent!==r&&(i.transparent=r,i.needsUpdate=!0),i.depthWrite=!r,e.opaqueCutout.value=+!r,e.pilotCutaway.value=+!!r,e.pilotActorImage.value=N.material.map;let[a,o]=ee,s=N.geometry.getAttribute(`uv`);e.pilotActorRect.value.set((a.x+1)*this.renderer.domElement.width/2,(a.y+1)*this.renderer.domElement.height/2,(o.x-a.x)*this.renderer.domElement.width/2,(o.y-a.y)*this.renderer.domElement.height/2),e.pilotActorUv.value.set(s.getX(2),s.getY(2),s.getX(1),s.getY(1));let c=t.mesh.geometry.getAttribute(`position`),l=[];for(let e=0;e<c.count;e++){let t=new Z(c.getX(e),c.getY(e),0).applyMatrix4(this.camera.projectionMatrix);l.push([(t.x+1)*this.renderer.domElement.width/2,(t.y+1)*this.renderer.domElement.height/2])}let u=e.pilotActorRect.value;e.pilotCutawayFloor.value.set(qa(l,u.x-4),qa(l,u.x+u.z+4)),n.has(t.id)&&this.kaPilotHiddenFaces.push(t.id)}}for(let e of i)this.suppress(e);this.suppressed.settle(),this.actorShadows.endFrame(),this.floorDecals.update(this.pendingDecals),this.catVendingImpact.update(this.catVendingFrame,{scale:y,vertical:b,right:x,basis:C,depthOf:e=>this.anchorDepth(e)},s);let P={depthOf:e=>this.anchorDepth(e),distanceOf:e=>De(e,A,v.viewDepth),eye:g.perspective?m(g.perspective):null,toward:v.toward};this.ottoProps.update(this.ottoPropState,s,P),this.plazaProps.update(this.plazaPropState,s,j?{...P,fadeOut:e=>this.propHidesFight(e,j)}:P),this.underlay.sync();let te=this.renderer.domElement,{width:ne,height:re}=this.scene.scale;if((te.width!==ne||te.height!==re)&&this.renderer.setSize(ne,re,!1),this.warmFirstFrame()){this.active=!1,this.lastRenderMs=performance.now()-u;return}this.renderer.render(this.world,this.camera),this.backdropAlpha>.001&&this.renderBackdropDim(),O||(this.warmTextures(),this.uploadPreparedActors()),this.releaseIdleActorTextures(),this.lastRenderMs=performance.now()-u,this.frames++}renderBackdropDim(){let e=this.backdropKeep.map(e=>this.cards.get(e)).filter(e=>!!e&&e.visible);if(this.backdropMode!==`dim`){let t=new X(.5,.5);if(e.length>0){let n=new Z,r=new Z;for(let t of e)r.add(t.getWorldPosition(n));r.divideScalar(e.length).project(this.camera),t.set((r.x+1)/2,(r.y+1)/2)}(this.decisiveFrame??=new po).render(this.renderer,this.backdropMode,this.backdropAlpha,t,this.backdropClockMs)}else this.renderBackdropSheet();this.renderKept(e)}renderBackdropSheet(){let e=this.backdropSheet??=(()=>{let e=new Ut,t=new Wt(-1,1,1,-1,0,1),n=new We({color:l.webtoonInk,transparent:!0,depthTest:!1,depthWrite:!1}),r=new q(new vt(2,2),n);return r.frustumCulled=!1,e.add(r),{scene:e,camera:t,material:n}})();e.material.opacity=this.backdropAlpha;let t=this.renderer,n=t.autoClear;t.autoClear=!1,t.render(e.scene,e.camera),t.autoClear=n}renderKept(e){let t=this.renderer,n=t.autoClear;if(t.autoClear=!1,e.length>0){t.clearDepth();let n=this.camera.layers.mask;for(let t of e)t.layers.enable(Ps);this.camera.layers.set(Ps),t.render(this.world,this.camera),this.camera.layers.mask=n;for(let t of e)t.layers.disable(Ps)}t.autoClear=n}firstFrameMeshes;firstFrameNext=0;firstFrameSliceBytes=Fs.sliceBytes;firstFrameStarted=0;firstFrameSeen=new Set;warmFirstFrame(){if(this.firstFrameMeshes===null)return!1;let e=performance.now();if(this.firstFrameMeshes===void 0){this.world.updateMatrixWorld(),this.camera.updateMatrixWorld();let t=new Ne().setFromProjectionMatrix(new Ke().multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse)),n=[];this.world.traverseVisible(e=>{let r=e;r.isMesh&&r.layers.test(this.camera.layers)&&(!r.frustumCulled||t.intersectsObject(r))&&n.push(r)}),this.firstFrameMeshes=n,this.firstFrameStarted=e}let t=this.firstFrameMeshes;if(this.firstFrameNext>=t.length||e-this.firstFrameStarted>Fs.giveUpMs)return this.firstFrameMeshes=null,this.firstFrameSeen.clear(),!1;let n=this.camera.layers.mask,r=this.renderer.getScissor(new K),i=this.renderer.getScissorTest();this.renderer.setScissorTest(!0),this.renderer.setScissor(0,0,1,1);try{for(;this.firstFrameNext<t.length&&performance.now()-e<Fs.frameMs;){let e=[],r=0;for(;this.firstFrameNext<t.length&&(!e.length||r<this.firstFrameSliceBytes);){let n=t[this.firstFrameNext++];r+=this.firstDrawBytes(n),e.push(n)}if(!r)continue;let i=performance.now();for(let t of e)t.layers.enable(Fs.layer);this.camera.layers.set(Fs.layer),this.renderer.render(this.world,this.camera),this.camera.layers.mask=n;for(let t of e)t.layers.disable(Fs.layer);let a=performance.now()-i;a>0&&r>=Fs.minSliceBytes&&(this.firstFrameSliceBytes=Math.max(Fs.minSliceBytes,Math.min(Fs.sliceBytes*2,r*Fs.frameMs/a)))}}finally{this.camera.layers.mask=n,this.renderer.setScissor(r),this.renderer.setScissorTest(i)}return!0}firstDrawBytes(e){let t=this.firstFrameSeen,n=0;if(!t.has(e.geometry)){t.add(e.geometry);for(let t of Object.values(e.geometry.attributes))n+=t.array?.byteLength??0;n+=e.geometry.index?.array.byteLength??0}for(let r of[e.material].flat()){let e=[r.map,...Object.values(r.uniforms??{}).map(e=>e.value)];for(let r of e){if(!(r instanceof Gt)||t.has(r)||this.isUploaded(r))continue;t.add(r);let e=r instanceof Bt?r.mipmaps[0]:null,i=r.image;n+=e?e.width*e.height:i?.data?i.data.byteLength:(i?.width??0)*(i?.height??0)*4}}return n}warmComplete=!1;warmDisabled=!1;lastActorSweepMs=0;releaseIdleActorTextures(){let e=performance.now();if(e-this.lastActorSweepMs<Vs)return;this.lastActorSweepMs=e;let t=0,n=[],r=new Set(this.keptActorKeys.filter(e=>this.scene.textures.exists(e)).map(e=>this.scene.textures.getFrame(e,0).source.image));for(let[i,a]of this.textures){if(a.userData.text)continue;let o=this.actorTextureBytes(a);if(t+=o,a.userData.decoding||r.has(i))continue;let s=e-(a.userData.lastUsedMs??e);s>=(this.preparedActors.has(i)?Bs:Ls)&&n.push({source:i,texture:a,ms:s,bytes:o})}n.sort((e,t)=>t.ms-e.ms);for(let e of n){if(t<=Rs&&e.ms<zs)break;this.dropActorTexture(e.source,e.texture),t-=e.bytes}}actorTextureBytes(e){if(!this.isUploaded(e))return 0;let t=e.image,[n,r]=e.userData.uploadedSize??[t?.width??0,t?.height??0];return n*r*(e instanceof Bt?1:4)}dropActorTexture(e,t){this.textures.delete(e),this.preparedActors.delete(e),this.preparedUploads.delete(e);for(let e of this.cards.values())e.userData.lastFrame?.texture===t&&delete e.userData.lastFrame,e.material.map===t&&(e.material.map=null,e.material.needsUpdate=!0);let n=t.image;n instanceof ImageBitmap&&this.bitmaps.delete(n)&&n.close(),t instanceof Bt&&this.compressedPending.delete(t),t.dispose()}warmTextures(){if(this.warmComplete||this.warmDisabled||!this.bitmaps.size&&!this.compressedPending.size)return;let e=new Set,t=t=>{t instanceof Gt&&(this.bitmaps.has(t.image)||t instanceof Bt&&this.compressedPending.has(t))&&e.add(t)};if(this.world.traverseVisible(e=>{let n=e.material;if(n)for(let e of[n].flat()){t(e.map);for(let n of Object.values(e.uniforms??{}))t(n.value)}}),!e.size){this.warmComplete=!0;return}let r=performance.now();for(let t of e){let e=t instanceof Bt?t.mipmaps[0]:null,i=t.image,a=performance.now(),o=e?e.width*e.height/n:i.width*i.height*4/n;this.renderer.initTexture(t);let s=performance.now();if(o>=1&&(s-a)/o>Is){this.warmDisabled=!0;break}if(s-r>Ns)break}}isUploaded(e){return!!this.renderer.properties.get(e).__webglTexture}renderStats(){let e=new Set,t=t=>{!(t instanceof Gt)||e.has(t)||this.isUploaded(t)&&e.add(t)};for(let e of this.imageTextures.values())t(e);for(let e of this.textures.values())t(e);this.world.traverse(e=>{let n=e.material;for(let e of n?[n].flat():[]){t(e.map);for(let n of Object.values(e.uniforms??{}))t(n.value)}});let r=0;for(let t of e){let e=t.image,[n,i]=t.userData.uploadedSize??[e?.width??0,e?.height??0],a=t instanceof Bt,o=t.format===qe,c=a?(t.userData.mipLevels??t.mipmaps.length)>1:t.generateMipmaps&&t.minFilter!==1006&&t.minFilter!==1003;r+=s(n,i,t.format===36283?.5:o||a?1:4,c)}let i=[...this.bitmaps].reduce((e,t)=>e+t.width*t.height*4,0),a=0,o=0;for(let e of this.textures.values()){if(e.userData.text)continue;let t=this.actorTextureBytes(e);t>0&&(a+=t,o++)}let c=this.renderer.info,l=this.renderer.domElement;return{active:this.active?`yes`:`no`,drawCalls:c.render.calls,triangles:c.render.triangles,update3dMs:Math.round(this.lastRenderMs*10)/10,programs:c.programs?.length??0,textures:e.size,textureMiB:Math.round(r/n),retainedBitmapMiB:Math.round(i/n),actorSheets:o,actorMiB:Math.round(a/n),actorBudgetMiB:Math.round(Rs/n),backbuffer:`${l.width}x${l.height}`}}capture(...e){return this.renderer.render(this.world,this.camera),this.renderer.domElement.toDataURL(...e)}probeOcclusion(){return null}actorOcclusion(e){let t=this.occlusionBody;if(!this.active||!t)return null;let n=this.occlusionLens;return this.occlusionFrom(t,n?.target??t.point,e)}bodyOcclusionAt(e,t){let n=this.occlusionBody;if(!this.active||!n)return null;let r=Math.hypot(t[0],t[1])||1;return this.occlusionFrom({...n,point:e,right:[-t[1]/r,t[0]/r]},e,t)}occlusionFrom(e,t,n){this.occluders??=this.definition.buildings.filter(e=>e.paintedVolume?.faces.length).map(e=>to(e.id,e.paintedVolume));let r=new Set([...this.buildings.filter(e=>e.paintedFaces?.some(e=>e.mesh.visible)).map(e=>e.definition.id),...this.townKit?.visibleIds??[]]),i=this.kaPilotHiddenFaces.length>0?de.id:null,a=this.occlusionLens?.distance??1e4,o=[t[0]+n[0]*a,t[1]+n[1]*a,n[2]*a];return io(this.occluders.filter(e=>r.has(e.id)&&e.id!==i),e,o)}isCardDrawn(e){return this.active?this.cards.get(e)?.visible===!0:`visible`in e&&e.visible===!0}get isReady(){return this.ready&&!this.renderer.getContext().isContextLost()}get isActive(){return this.active}snapshot(){return{kaPilotHiddenFaces:this.kaPilotHiddenFaces,ready:this.isReady,active:this.active,failure:this.failure,frames:this.frames,angle:this.angle,buildingMeshes:0,buildingCards:this.buildings.length,buildingPreview:this.buildingPreview,plazaVending:this.plazaVending,compositionShopIds:this.buildings.filter(e=>e.definition.id.startsWith(`preview-shop-`)&&e.paintedFaces?.some(e=>e.mesh.visible)).map(e=>e.definition.id),visibleBuildingIds:[...this.buildings.filter(e=>/^B\d+$/.test(e.definition.id)&&(e.mesh.visible||e.paintedFaces?.some(e=>e.mesh.visible))).map(e=>e.definition.id),...this.townKit?.visibleIds??[]],townKitBuildings:this.townKit?.visibleIds.length??0,townKitBatches:this.townKit?.batchCount??0,cardRotation:this.buildings.some(e=>e.paintedFaces)?`painted-volume-and-image-cards`:`registered-upright-affine`,handoverDegrees:Us,groundPlanes:+!!this.ground,cards:this.cards.size,imageTextureCount:this.imageTextures.size,highResolutionGround:!!this.definition.ground.materials,foundationCalibratedCards:this.foundationCalibratedCards,foundationMaxError:this.foundationMaxError,foundationFacingFailures:this.foundationFacingFailures,paintedVolumeCards:this.buildings.filter(e=>e.paintedFaces).length,paintedVolumeFaces:this.buildings.reduce((e,t)=>e+(t.paintedFaces?.length??0),0),staticShadows:!1,triangles:this.ground?2:0,actorCovered:null,occlusionSampleFrame:-1,bakedGroundShadow:this.groundShadow?.mesh.visible??!1,groundShadowBytes:this.groundShadow?P.gpuBytes:0,distantBackdrop:!1,daySky:`directional-daylight`,renderResolution:[this.renderer.domElement.width,this.renderer.domElement.height],actorContactShadows:this.actorShadows.visibleCount,floorDecalMeshes:this.floorDecals.visibleCount,catVendingImpactMeshes:this.catVendingImpact.visibleCount,ottoPropMeshes:this.ottoProps.visibleCount,plazaPropMeshes:this.plazaProps.visibleCount,groundBeforeActors:this.ground?!this.ground.material.transparent&&!this.ground.material.depthWrite:!1,propContactShadows:this.streetFinishing?.propContactCount??0,foundationFinish:this.streetFinishing?.foundationSnapshot??null,propVolumes:this.propVolumes?.count??0,renderMs:this.lastRenderMs,drawCalls:this.renderer.info.render.calls,visibleTriangles:this.renderer.info.render.triangles}}destroy(){if(!this.destroyed){this.destroyed=!0,this.abort.abort(),this.restore(),this.underlay.release(),this.releaseStats(),this.layoutGuide.dispose(),this.shopFinishing?.dispose(),this.streetFinishing?.dispose(),this.groundShadow?.dispose(),this.propVolumes?.dispose(),this.townKit?.dispose();for(let e of this.cards.values())e.geometry.dispose(),e.material.dispose();if(this.backdropSheet){for(let e of this.backdropSheet.scene.children)e instanceof q&&e.geometry.dispose();this.backdropSheet.material.dispose()}this.decisiveFrame?.dispose(),this.actorShadows.dispose(),this.floorDecals.dispose(),this.catVendingImpact.dispose(),this.catVendingShadow.dispose(),this.ottoProps.dispose(),this.plazaProps.dispose();for(let e of this.buildings){e.mesh.geometry.dispose(),e.mesh.material.dispose();for(let t of e.paintedFaces??[])t.mesh.geometry.dispose(),t.mesh.material.dispose()}this.ground?.geometry.dispose(),this.ground?.material.dispose(),this.silhouette?.material.dispose(),this.daySky.dispose();for(let e of this.textures.values())e.dispose();for(let e of this.imageTextures.values())e.dispose();for(let e of this.bitmaps)e.close();this.bitmaps.clear(),this.renderer,this.renderer.dispose(),this.renderer.forceContextLoss()}}};export{Js as NativeCityCardView};