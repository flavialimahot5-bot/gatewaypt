import { z } from "zod";
export async function GET(_request: Request, { params }: { params: Promise<{ cep: string }> }) {
  const { cep } = await params;
  if (!/^\d{8}$/.test(cep)) return Response.json({ error: "CEP inválido." }, { status: 400 });
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(5000), redirect: "error", next: { revalidate: 86400 } });
    if (!response.ok) throw new Error("unavailable");
    const body = await response.json();
    if (body.erro) return Response.json({ error: "CEP não encontrado. Preencha o endereço manualmente." }, { status: 404 });
    const data = z.object({ logradouro: z.string().max(180), bairro: z.string().max(100), localidade: z.string().min(1).max(100), uf: z.string().regex(/^[A-Z]{2}$/) }).parse(body);
    return Response.json({ street: data.logradouro, district: data.bairro, city: data.localidade, state: data.uf }, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch {
    return Response.json({ error: "Consulta indisponível. Preencha o endereço manualmente." }, { status: 503 });
  }
}
