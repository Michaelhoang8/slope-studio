export const presets={
 valley:{formula:'(1-x)^2 + 100*(y-x^2)^2',x:-1.2,y:1,rate:0.002,steps:1000,bounds:[-2,2,-1,3]},
 bowl:{formula:'x^2 + 4*y^2',x:2,y:1.5,rate:0.08,steps:200,bounds:[-3,3,-3,3]},
 ripples:{formula:'0.2*(x^2+y^2) + sin(3*x)*cos(3*y)',x:1.7,y:1.2,rate:0.03,steps:300,bounds:[-3,3,-3,3]},
 saddle:{formula:'x^2-y^2',x:0,y:0,rate:0.05,steps:100,bounds:[-2,2,-2,2]},
};
export const example={...presets.valley,clip:0,tolerance:1e-6};
export function compile(source){
 if(typeof source!=='string'||source.length<1||source.length>1000)throw Error('Expression must contain 1–1,000 characters.');
 const tokens=[];let offset=0;while(offset<source.length){if(/\s/.test(source[offset])){offset++;continue;}const m=/^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z]+|[()+*/^\-])/.exec(source.slice(offset));if(!m)throw Error(`Unexpected character at column ${offset+1}.`);tokens.push({text:m[0],offset});offset+=m[0].length;}
 if(tokens.length>300)throw Error('Use at most 300 tokens.');let position=0;const nodes=[],variables={};
 const peek=()=>tokens[position]?.text;
 const take=t=>{if(peek()!==t)throw Error(`Expected ${t} at column ${(tokens[position]?.offset??source.length)+1}.`);position++;};
 const add=(op,args=[],extra={})=>{if(nodes.length>=100)throw Error('Use at most 100 tape nodes.');nodes.push({id:nodes.length,op,args,...extra});return nodes.length-1;};
 function atom(depth){if(depth>32)throw Error('Expression nesting is limited to 32 levels.');const token=peek();
  if(token==='('){position++;const value=sum(depth+1);take(')');return value;}
  if(token==='x'||token==='y'){position++;if(variables[token]===undefined)variables[token]=add(token);return variables[token];}
  if(['sin','cos','exp','log','sqrt'].includes(token)){position++;take('(');const value=sum(depth+1);take(')');return add(token,[value]);}
  if(token&&/^(?:\d|\.)/.test(token)){position++;const value=Number(token);if(!Number.isFinite(value)||Math.abs(value)>1e6)throw Error('Constants must be finite and at most 1e6 in magnitude.');return add('constant',[],{constant:value});}
  throw Error(`Expected x, y, a number, or a supported function at column ${(tokens[position]?.offset??source.length)+1}.`);
 }
 function power(depth){let value=atom(depth);if(peek()==='^'){position++;const token=peek();if(!token||!/^\d+$/.test(token)||Number(token)>8)throw Error('Powers must be integer constants from 0 to 8.');position++;value=add('power',[value],{exponent:Number(token)});}return value;}
 function unary(depth){if(depth>32)throw Error('Expression nesting is limited to 32 levels.');if(peek()==='-'||peek()==='+'){const op=peek();position++;const value=unary(depth+1);return op==='-'?add('negate',[value]):value;}return power(depth);}
 function product(depth){let value=unary(depth);while(peek()==='*'||peek()==='/'){const op=peek();position++;value=add(op,[value,unary(depth)]);}return value;}
 function sum(depth){let value=product(depth);while(peek()==='+'||peek()==='-'){const op=peek();position++;value=add(op,[value,product(depth)]);}return value;}
 const output=sum(0);if(position!==tokens.length)throw Error(`Unexpected token ${peek()} at column ${tokens[position].offset+1}.`);return {source,nodes,variables,output};
}
function finite(value,description){if(!Number.isFinite(value)||Math.abs(value)>1e100)throw Error(`${description} is nonfinite or exceeds the numerical bound.`);return value;}
export function evaluate(compiled,x,y,gradient=true){
 finite(x,'x');finite(y,'y');const tape=[];
 for(const node of compiled.nodes){const args=node.args.map(i=>tape[i].value);let value,local=[];
  switch(node.op){
   case 'x':value=x;break;case 'y':value=y;break;case 'constant':value=node.constant;break;
   case '+':value=args[0]+args[1];local=[1,1];break;
   case '-':value=args[0]-args[1];local=[1,-1];break;
   case '*':value=args[0]*args[1];local=[args[1],args[0]];break;
   case '/':if(args[1]===0)throw Error('Division by zero.');value=args[0]/args[1];local=[1/args[1],-args[0]/args[1]**2];break;
   case 'negate':value=-args[0];local=[-1];break;
   case 'power':value=args[0]**node.exponent;local=[node.exponent===0?0:node.exponent*args[0]**(node.exponent-1)];break;
   case 'sin':value=Math.sin(args[0]);local=[Math.cos(args[0])];break;
   case 'cos':value=Math.cos(args[0]);local=[-Math.sin(args[0])];break;
   case 'exp':value=Math.exp(args[0]);local=[value];break;
   case 'log':if(args[0]<=0)throw Error('log requires a positive argument.');value=Math.log(args[0]);local=[1/args[0]];break;
   case 'sqrt':if(args[0]<0||(gradient&&args[0]===0))throw Error('sqrt requires a positive argument for a finite derivative.');value=Math.sqrt(args[0]);local=[.5/value];break;
   default:throw Error('Unknown tape operation.');
  }
  finite(value,`Node ${node.id} value`);if(gradient)local.forEach(v=>finite(v,`Node ${node.id} local derivative`));tape.push({...node,value,local,adjoint:0});
 }
 const value=tape[compiled.output].value;if(!gradient)return {value};
 tape[compiled.output].adjoint=1;
 for(let i=tape.length-1;i>=0;i--)for(let j=0;j<tape[i].args.length;j++){const parent=tape[i].args[j];tape[parent].adjoint=finite(tape[parent].adjoint+tape[i].adjoint*tape[i].local[j],`Node ${parent} adjoint`);}
 const dx=compiled.variables.x===undefined?0:tape[compiled.variables.x].adjoint,dy=compiled.variables.y===undefined?0:tape[compiled.variables.y].adjoint;
 return {value,gradient:[dx,dy],norm:Math.hypot(dx,dy),tape};
}
export function numericalCheck(compiled,x,y){
 const exact=evaluate(compiled,x,y),checks=[];
 for(let axis=0;axis<2;axis++){
  const point=[x,y],h=1e-5*Math.max(1,Math.abs(point[axis])),plus=[...point],minus=[...point];plus[axis]+=h;minus[axis]-=h;
  try{const numeric=(evaluate(compiled,...plus,false).value-evaluate(compiled,...minus,false).value)/(2*h),error=Math.abs(numeric-exact.gradient[axis]);checks.push({axis:axis?'y':'x',step:h,automatic:exact.gradient[axis],numeric,absoluteError:error,scaledError:error/Math.max(1,Math.abs(numeric),Math.abs(exact.gradient[axis]))});}
  catch(error){checks.push({axis:axis?'y':'x',step:h,automatic:exact.gradient[axis],numeric:null,error:error.message});}
 }return checks;
}
export function validate(raw){
 if(!raw||typeof raw!=='object')throw Error('Expected an experiment object.');const ranges={x:[-100,100],y:[-100,100],rate:[1e-6,1],steps:[1,2000],clip:[0,10000],tolerance:[1e-12,1]};
 for(const [key,[lo,hi]]of Object.entries(ranges))if(typeof raw[key]!=='number'||!Number.isFinite(raw[key])||raw[key]<lo||raw[key]>hi)throw Error(`${key} must be between ${lo} and ${hi}.`);
 if(!Number.isInteger(raw.steps))throw Error('Steps must be an integer.');
 if(!Array.isArray(raw.bounds)||raw.bounds.length!==4||raw.bounds.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>100)||raw.bounds[1]-raw.bounds[0]<.01||raw.bounds[3]-raw.bounds[2]<.01)throw Error('Plot bounds must span at least 0.01 on each axis and stay within [-100,100].');
 const compiled=compile(raw.formula);return {input:{formula:raw.formula,...Object.fromEntries(Object.keys(ranges).map(k=>[k,raw[k]])),bounds:[...raw.bounds]},compiled};
}
export function optimize(compiled,input,method){
 if(!['gradient','momentum','adam'].includes(method))throw Error('Unknown optimizer.');let x=input.x,y=input.y,m=[0,0],v=[0,0];const trace=[];let status='Step budget reached',failure=null;
 for(let iteration=0;iteration<=input.steps;iteration++){
  let current;try{current=evaluate(compiled,x,y);}catch(error){status='Numerical/domain stop';failure={iteration,x,y,message:error.message};break;}
  trace.push({iteration,x,y,value:current.value,dx:current.gradient[0],dy:current.gradient[1],norm:current.norm});
  if(current.norm<=input.tolerance){status='Gradient tolerance reached';break;}if(iteration===input.steps)break;
  let g=[...current.gradient];if(input.clip>0&&current.norm>input.clip)g=g.map(z=>z*input.clip/current.norm);
  const step=iteration+1,update=g.map((value,j)=>{
   if(method==='gradient')return value;
   if(method==='momentum'){m[j]=.9*m[j]+value;return m[j];}
   m[j]=.9*m[j]+.1*value;v[j]=.999*v[j]+.001*value*value;return(m[j]/(1-.9**step))/(Math.sqrt(v[j]/(1-.999**step))+1e-8);
  });
  const nx=x-input.rate*update[0],ny=y-input.rate*update[1];
  if(!Number.isFinite(nx)||!Number.isFinite(ny)||Math.abs(nx)>1e6||Math.abs(ny)>1e6){status='Coordinate bound reached';failure={iteration:step,x:Number.isFinite(nx)?nx:null,y:Number.isFinite(ny)?ny:null,message:'Proposed coordinate exceeds ±1e6 or is nonfinite.'};break;}
  x=nx;y=ny;
 }return {method,status,failure,trace};
}
export function surface(compiled,bounds,size=64){
 const [xmin,xmax,ymin,ymax]=bounds,values=[];let min=Infinity,max=-Infinity,invalid=0;
 for(let row=0;row<size;row++)for(let col=0;col<size;col++){
  const x=xmin+(col+.5)/size*(xmax-xmin),y=ymax-(row+.5)/size*(ymax-ymin);
  try{const value=evaluate(compiled,x,y,false).value;values.push(value);min=Math.min(min,value);max=Math.max(max,value);}catch{values.push(null);invalid++;}
 }return {size,values,min:Number.isFinite(min)?min:null,max:Number.isFinite(max)?max:null,invalid};
}
export function analyze(raw){const {input,compiled}=validate(raw),initial=evaluate(compiled,input.x,input.y),check=numericalCheck(compiled,input.x,input.y),runs=['gradient','momentum','adam'].map(method=>optimize(compiled,input,method));return {input,compiled,initial,check,runs,surface:surface(compiled,input.bounds)};}
