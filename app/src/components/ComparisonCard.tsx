import React from "react";
import { ScrollView, Text, View } from "@tarojs/components";
import type { ComparisonPayload } from "../types/shopguide";
import "./ComparisonCard.scss";

export function ComparisonCard({ comparison }: { comparison: ComparisonPayload }) {
  if (!comparison.columns?.length || !comparison.rows?.length) return null;

  return (
    <View className="comparison">
      <Text className="comparison-title">{comparison.title || "商品对比"}</Text>
      {comparison.conclusion ? <Text className="comparison-conclusion">{comparison.conclusion}</Text> : null}
      <ScrollView scrollX className="comparison-scroll">
        <View className="comparison-table">
          <View className="comparison-row header-row">
            <Text className="cell label-cell">维度</Text>
            {comparison.columns.map((column) => (
              <Text key={column.productId} className="cell product-cell">
                {column.label || column.brand || column.title || column.productId}
              </Text>
            ))}
          </View>
          {comparison.rows.map((row) => (
            <View key={row.label} className="comparison-row">
              <Text className="cell label-cell">{row.label}</Text>
              {comparison.columns?.map((column) => (
                <Text key={column.productId} className="cell product-cell">
                  {row.values.find((item) => item.productId === column.productId)?.value || "-"}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
