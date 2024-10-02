<template>

  <div style="width: 1400px;">
    <h1>Code Dependency</h1>

    <el-form :model="form" label-width="auto" style="width: 100%">
      <el-row>
        <el-col :span="24">
          <el-form-item label="Direction">
            <el-radio-group v-model="form.direction">
              <el-radio value="descendants">Descendants</el-radio>
              <el-radio value="ancestors">Ancestors</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <el-form-item label="Category">
            <el-select v-model="form.category" placeholder="Category" style="width: 240px">
              <el-option v-for="item in categories" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="Micro-Service">
            <el-input v-model="form.microService" style="width: 240px" placeholder="Micro-Service" readonly />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="System Module">
            <el-input v-model="form.systemModule" style="width: 240px" placeholder="System Module" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="Name">
            <el-input v-model="form.name" style="width: 240px" placeholder="Name" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item>
        <el-button type="primary" @click="retrieve">Retrieve</el-button>
      </el-form-item>
    </el-form>

    <v-chart :option="graphOptions" style="width: 100%; height: 500px;"/>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import axios from 'axios';
import { use } from 'echarts/core';
import { SankeyChart, TreeChart } from 'echarts/charts';
import {
  TitleComponent,
  LegendComponent,
  TooltipComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import VChart, { THEME_KEY } from 'vue-echarts';
import { getSankeyOptions } from './sankey.js';
import { getTreeOptions } from './tree.js';

use([
  TitleComponent,
  LegendComponent,
  TooltipComponent,
  SankeyChart,
  TreeChart,
  CanvasRenderer
]);

const categories = [
  { value: 'component', label: 'Component' },
  { value: 'systemModule', label: 'System Module' }
]

const form = reactive({
  direction: 'ancestors',
  category: 'component',
  microService: 'dep-graph-builder',
  systemModule: '/graph/graph.service.js',
  name: 'getAncestors'
})

const graphData = {
  "nodes": [],
  "links": []
};

const graphOptions = ref(getTreeOptions(graphData, form.direction));

async function retrieve() {
  const response = await axios.get(`/api/graph/${form.direction}?category=${form.category}&name=${encodeURIComponent(form.name)}&systemModule=${encodeURIComponent(form.systemModule)}&microService=${encodeURIComponent(form.microService)}`)
  const newOptions = getTreeOptions(response.data, form.direction);
  // const newOptions = getSankeyOptions(response.data);

  graphOptions.value = newOptions;
}
</script>

<style>
@media (min-width: 1024px) {
  .about {
    min-height: 100vh;
    display: flex;
    align-items: center;
  }
}
</style>
