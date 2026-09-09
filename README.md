# Escala EVR

Programa em HTML, CSS e JavaScript para gerenciar escalas de plantao.

## Funcionalidades

- Calendario mensal com cards arrastaveis.
- Regimes 24x72, 12x36, Comercial e Comercial Fixo.
- Preenchimento automatico e inteligente de plantoes.
- Restricoes por ferias, curso, feriado e outros impedimentos.
- Conferencia de inconsistencias de folga.
- Relatorios mensais e acumulados.
- Importacao de dados antigos e exportacao CSV.
- Salvamento e carregamento de backups.
- Historico para desfazer movimentos.

## Como usar

Abra o arquivo `index.html` no navegador.

Os dados do uso normal ficam salvos no armazenamento local do navegador. Para preservar historico entre computadores ou navegadores, use as opcoes de salvar/carregar backup do proprio programa.

## Ferias da equipe

O acesso `ferias.html` permite selecionar um nome, cadastrar, editar e excluir somente ferias dessa pessoa, e consultar o calendario coletivo de ferias. O calendario mostra a quantidade de pessoas ausentes, sem impor limite simultaneo. A escala continua em `index.html`.

As regras configuradas sao: ate 30 dias por competencia, ate tres periodos, sem numero de periodo repetido ou sobreposicao com impedimentos da mesma pessoa. Ao cadastrar o terceiro periodo, o total precisa completar 30 dias. O primeiro periodo comeca entre segunda e quinta-feira; os demais nao possuem esse bloqueio. Estas sao as regras operacionais definidas para este aplicativo.

### Ativacao

1. No aparelho com os dados corretos, salve um backup.
2. Substitua o codigo do Apps Script pelo conteudo completo de `google-apps-script.js`.
3. Em Gerenciar implantacoes, edite a implantacao existente, selecione Nova versao e implante. Mantenha a URL atual e o acesso do aplicativo web configurado para qualquer pessoa.
4. Atualize a pagina administrativa e envie os dados corretos para a nuvem. Se houver conflito anterior, preserve o backup local e confira a nuvem antes de combinar os dados.
5. Distribua `https://betoengmece.github.io/ESCALA_EVR/ferias.html`.

O botao Salvar minhas ferias grava apenas um registro, sem mudar a escala. O servidor serializa gravacoes com bloqueio e compara a revisao do registro antes de editar ou excluir. Em conflito, a edicao permanece no formulario; Atualizar consulta os dados mais recentes antes de uma nova edicao.

O envio administrativo combina as restricoes usando a ultima copia sincronizada: alteracoes independentes sao preservadas, inclusive inclusoes e exclusoes. Alteracoes divergentes no mesmo registro bloqueiam o envio. Clientes antigos sem essa copia de referencia nao podem forcar uma substituicao de dados mais recentes. A senha administrativa existente tambem e conferida no servidor.

A selecao por nome funciona por confianca: nao comprova identidade e permite selecionar outro nome. A senha simples administrativa permanece no codigo do aplicativo; nao constitui autenticacao forte. A equipe nao recebe controles de edicao da escala nessa pagina.

### Verificacao

`node --test tests/team-sync.test.cjs` verifica regras, conflitos, isolamento de registros e combinacao administrativa sem acessar dados reais. `tests/team-ui.cjs` usa Playwright e Chrome, com respostas ficticias da nuvem, para verificar o formulario em computador e celular.
