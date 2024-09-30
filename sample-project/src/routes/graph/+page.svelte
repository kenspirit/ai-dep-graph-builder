<script>
  import axios from 'axios';
  import { Chart } from 'svelte-echarts';

  import { init, use } from 'echarts/core';
  import { GraphChart } from 'echarts/charts';
  import { TitleComponent } from 'echarts/components';
  import { CanvasRenderer } from 'echarts/renderers';

  // now with tree-shaking
  use([GraphChart, CanvasRenderer, TitleComponent])

  export let direction = 'descendants';
  export let category = 'component';
  export let name = '';
  export let systemModule = '';
  export let microService = 'dep-graph-builder';

  let graphData = { nodes: [], links: [], categories: [] };

  let options = getGraphOptions(graphData);

  function getGraphOptions(graphData) {
    return {
      tooltip: {},
      width: 1280,
      height: 960,
      layout: 'force',
      legend: [
        {
          data: graphData.categories.map(function (a) {
            return a.name;
          })
        }
      ],
      series: [
        {
          name: 'Code Dependency',
          type: 'graph',
          layout: 'none',
          data: graphData.nodes,
          links: graphData.links,
          categories: graphData.categories,
          roam: true,
          label: {
            show: true,
            position: 'right',
            formatter: '{b}'
          },
          labelLayout: {
            hideOverlap: true
          },
          scaleLimit: {
            min: 0.4,
            max: 2
          },
          lineStyle: {
            color: 'source',
            curveness: 0.3
          }
        }
      ]
    };
  }

  const retrieve = async () => {
    const response = await axios.get(`api/graph/${direction}?category=${category}&name=${encodeURIComponent(name)}&systemModule=${encodeURIComponent(systemModule)}&microService=${encodeURIComponent(microService)}`)
    // graphData = response.data.graphData;

    graphData = {
      "nodes": [
        {
          "id": "0",
          "name": "Myriel",
          "symbolSize": 19.12381, // File - 12, Function/Field - 4, API - 8
          "value": 28.685715,
          "category": 0
        }
      ],
      "links": [
        {
          "source": "1",
          "target": "0"
        }
      ],
      "categories": [
        {
          "name": "A"
        }
      ]
    }

    options = getGraphOptions(graphData);
  }
</script>

<div>
  <h1>Graph</h1>
  <div>
    <label>
      <input type="radio" bind:group={direction} value="descendants">
      Descendants
    </label>
    <label>
      <input type="radio" bind:group={direction} value="ancestors">
      Ancestors
    </label>
  </div>

  <select bind:value={category}>
    <option value="component">Component</option>
    <option value="systemModule">System Module</option>
  </select>
  <input type="text" bind:value={microService} readonly />
  <br />
  <input type="text" bind:value={name} required/>
  <input type="text" bind:value={systemModule} />
  <br />
  <button on:click={retrieve}>Retrieve</button>
  <br />

  <Chart {init} {options} />
</div>
